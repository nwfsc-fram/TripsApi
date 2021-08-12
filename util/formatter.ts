import { Catches, CatchResults, ResponseCatchTypeName, MinimalResponseCatchTypeName, Disposition, sourceType, ManagementArea, DcsRowTypeName } from '@boatnet/bn-models';
import { set, get, uniqBy, sumBy, cloneDeep } from 'lodash';
import { end } from 'routes/docs-content';
import { masterDev } from './couchDB';
const jp = require('jsonpath');
const moment = require('moment');

export async function format(tripNum: number, logbook: Catches, review: Catches, audit: Catches, expansionType: string) {
    console.log('formatting results');
    let result: CatchResults = {
        type: expansionType,
        tripNum: tripNum
    };
    const logbookCatch: any[] = await catchToHaul(logbook);
    const reviewCatch: any[] = await catchToHaul(review);
    const auditCatch: any[] = await catchToHaul(audit);
    set(result, 'logbookCatch', logbookCatch);
    set(result, 'thirdPartyReviewCatch', reviewCatch);
    set(result, 'nwfscAuditCatch', auditCatch);

    console.log('ifq grouping');
    const ifqLogbookCatchHaulLevel = await setIFQHaulLevelData(cloneDeep(result.logbookCatch), tripNum, 'logbook');
    const ifqThirdPartyReviewCatchHaulLevel = await setIFQHaulLevelData(cloneDeep(result.thirdPartyReviewCatch), tripNum, 'review');
    const ifqNwfscAuditHaulLevel = await setIFQHaulLevelData(cloneDeep(result.nwfscAuditCatch), tripNum, 'audit');
    set(result, 'ifqLogbookCatchHaulLevel', ifqLogbookCatchHaulLevel);
    set(result, 'ifqThirdPartyReviewCatchHaulLevel', ifqThirdPartyReviewCatchHaulLevel);
    set(result, 'ifqNwfscAuditHaulLevel', ifqNwfscAuditHaulLevel);

    const ifqLogbookTripLevel = await setTripLevelData(result.ifqLogbookCatchHaulLevel);
    const ifqThirdPartyReviewTripLevel = await setTripLevelData(result.ifqThirdPartyReviewCatchHaulLevel);
    const ifqNwfscAuditTripLevel = await setTripLevelData(result.ifqNwfscAuditHaulLevel);
    set(result, 'ifqLogbookTripLevel', ifqLogbookTripLevel);
    set(result, 'ifqThirdPartyReviewTripLevel', ifqThirdPartyReviewTripLevel);
    set(result, 'ifqNwfscAuditTripLevel', ifqNwfscAuditTripLevel);

    const ifqTripReporting = await setIFQTripReporting(result);
    set(result, 'ifqTripReporting', ifqTripReporting);
    console.log('ifq grouping complete');

    console.log('grading logbook');
    result = gradeLogbook(result);

    return result;
}

async function catchToHaul(catchVals: Catches) {
    const results: any[] = [];
    let pacfinSpeciesCode = "";
    let wcgopSpeciesCode: number = null;

    for (const haul of get(catchVals, 'hauls', [])) {
        for (const catchVal of get(haul, 'catch', [])) {
            const count = catchVal.speciesCount ? catchVal.speciesCount : null;

            const speciesCode = parseInt(catchVal.speciesCode) ? parseInt(catchVal.speciesCode) : catchVal.speciesCode;
            // lookup code to get pacfinSpeciesCode, wcgopSpeciesCode, and docId
            const codeLookup = await masterDev.view('em-views', 'wcgopCode-to-pacfinCode-map',
                { "key": speciesCode, "include_docs": false });
            if (typeof codeLookup.rows[0].key === 'string') {
                pacfinSpeciesCode = codeLookup.rows[0].key;
                wcgopSpeciesCode = parseInt(codeLookup.rows[0].value, 10);
            } else {
                pacfinSpeciesCode = codeLookup.rows[0].value;
                wcgopSpeciesCode = parseInt(codeLookup.rows[0].key, 10);
            }
            results.push({
                disposition: catchVal.disposition,
                haulNum: haul.haulNum,
                speciesWeight: catchVal.speciesWeight,
                speciesCount: count,
                pacfinSpeciesCode,
                wcgopSpeciesCode,
                docId: codeLookup.rows[0].id,
                startDepth: haul.startDepth,
                startLatitude: haul.startLatitude,
                startLongitude: haul.startLongitude,
                endDepth: haul.endDepth,
                endLatitude: haul.endLatitude,
                endLongitude: haul.endLongitude,
                gear: haul.gear,
                fisherySector: catchVals.fisherySector,
                comments: catchVal.comments ? catchVal.comments : '',
                calcWeightType: catchVal.calcWeightType ? catchVal.calcWeightType : '',
                // fishery
                // ifqSpeciesGroupName
                // fishingArea
            })
        }
    }
    return results;
}

async function determineFishingArea(latitude) {
    console.log('determining fishing area');
    let managementAreaBounds = await masterDev.view('obs_web', 'all_doc_types', {reduce: false, include_docs: true, key: 'fishing-area-lat-bounds'});
    managementAreaBounds = managementAreaBounds.rows[0].doc.latBounds;

    let fishingArea: string = '';

    if (latitude > managementAreaBounds['100'].lowerLimit) {
        fishingArea = '100';
    } else if (latitude >= managementAreaBounds['200'].lowerLimit && latitude <= managementAreaBounds['200'].upperLimit) {
        fishingArea = '200';
    } else if (latitude >= managementAreaBounds['300'].lowerLimit && latitude <= managementAreaBounds['300'].upperLimit) {
        fishingArea = '300';
    } else {
        fishingArea = '400';
    }
    return fishingArea;
}

async function setIFQHaulLevelData(catchResults: any[], tripNum, source) {
    // get ifq grouping name for each record based speciesCode and lat and long
    const ifqHaulLevelData: any[] = [];
    for (const catchResult of catchResults) {
        let groupName: string | null = null;
        let speciesGroupId: number | string = null;
        let ifqGroupings = await masterDev.view('Ifq', 'speciesCode-to-ifq-grouping',
            { "keys": [parseInt(catchResult.wcgopSpeciesCode, 10), catchResult.wcgopSpeciesCode.toString()], "include_docs": true });
        ifqGroupings = ifqGroupings.rows.map( (row: any) => row.doc );

        console.log('getting start and end grouping');
        let startGrouping = null;
        let endGrouping = null;
        const startFishingArea = await determineFishingArea(catchResult.startLatitude);
        const endFishingArea = await determineFishingArea(catchResult.endLatitude);
        let splitGroupings = [];
        for (const grouping of ifqGroupings) {
            for (const ra of grouping.regulationAreas) {
                for (const ta of ra.taxonomyAliases) {
                    if (
                        (parseInt(ta.wcgopSpeciesCode, 10) === parseInt(catchResult.wcgopSpeciesCode, 10)) &&
                        (catchResult.startLatitude >= (ra.lowerLatitude ? ra.lowerLatitude : 32.5)) &&
                        (catchResult.startLatitude <= (ra.upperLatitude ? ra.upperLatitude : 49))
                    ) {
                        startGrouping = grouping;
                        console.log(catchResult.wcgopSpeciesCode + ' | ' +  grouping.groupName)
                        console.log(catchResult.startLatitude + ' | ' + (ra.lowerLatitude ? ra.lowerLatitude : 32.5))
                        console.log(catchResult.startLatitude + ' | ' + (ra.upperLatitude ? ra.upperLatitude : 49))
                    }
                    if (
                        (parseInt(ta.wcgopSpeciesCode, 10) === parseInt(catchResult.wcgopSpeciesCode, 10)) &&
                        (catchResult.endLatitude >= (ra.lowerLatitude ? ra.lowerLatitude : 32.5)) &&
                        (catchResult.endLatitude <= (ra.upperLatitude ? ra.upperLatitude : 49))
                    ) {
                        endGrouping = grouping;
                        console.log(catchResult.wcgopSpeciesCode + ' | ' +  grouping.groupName)
                        console.log(catchResult.endLatitude + ' | ' + (ra.lowerLatitude ? ra.lowerLatitude : 32.5))
                        console.log(catchResult.endLatitude + ' | ' + (ra.upperLatitude ? ra.upperLatitude : 49))
                    }
                }
            }
        }

        if (startGrouping && endGrouping && startGrouping.groupName === endGrouping.groupName) {
            groupName = startGrouping.groupName;
            speciesGroupId = startGrouping.speciesGroupId;
            catchResult.fishingArea = startFishingArea;
        } else if (startGrouping && endGrouping && startGrouping.groupName !== endGrouping.groupName) {
            groupName = startGrouping.groupName + '/' + endGrouping.groupName;
            speciesGroupId = startGrouping.speciesGroupId + '/' + endGrouping.speciesGroupId;
            catchResult.fishingArea = startFishingArea;
        } else if (startGrouping) {
            groupName = startGrouping.groupName;
            speciesGroupId = startGrouping.speciesGroupId;
            catchResult.fishingArea = startFishingArea;
        } else if (endGrouping) {
            groupName = endGrouping.groupName;
            speciesGroupId = endGrouping.speciesGroupId;
            catchResult.fishingArea = endFishingArea;
        }

        if (groupName) {
            console.log('catch assigned to group - ' + groupName);
            catchResult.ifqGrouping = groupName;
            catchResult.speciesGroupId = speciesGroupId;
            if (catchResult.ifqGrouping.indexOf('/') !== -1) {
                console.log('found split grouping');
                const name1 = catchResult.ifqGrouping.split('/')[0];
                const id1 = catchResult.speciesGroupId.split('/')[0];
                const name2 = catchResult.ifqGrouping.split('/')[1];
                const id2 = catchResult.speciesGroupId.split('/')[1];
                catchResult.speciesWeight = catchResult.speciesWeight / 2;
                catchResult.ifqGrouping = name1;
                catchResult.speciesGroupId = id1;
                let newGroupCatch = cloneDeep(catchResult);
                newGroupCatch.ifqGrouping = name2;
                newGroupCatch.speciesGroupId = id2;
                newGroupCatch.fishingArea = endFishingArea;
                splitGroupings.push(newGroupCatch);

                let oldErrors = await masterDev.view(
                    'obs_web',
                    'boatnet-errors',
                    {'key': tripNum, "include_docs": true}
                )
                oldErrors = oldErrors.rows.map( (row) => {
                        row.doc._deleted = true;
                        return row.doc;
                    }
                );
                await masterDev.bulk({docs: oldErrors});

                const groupingError = {
                    "type": "boatnet-error",
                    "context": source + "- IFQ grouping",
                    "app": "TripsApi",
                    "error": catchResult.wcgopSpeciesCode + " catch split into 2 groupings: " + name1 + " and " + name2 + " based on startLatitude " + catchResult.startLatitude + " and endLatitude: " + catchResult.endLatitude,
                    "date": moment().format(),
                    "tripNum": tripNum,
                    "haulNum": catchResult.haulNum
                }
                if ((startFishingArea !== endFishingArea) && source === 'logbook') {
                    const fishingAreaError = {
                        "type": "boatnet-error",
                        "context": source +  "- Fishing Areas",
                        "error": catchResult.wcgopSpeciesCode + " catch split into 2 fishing areas: " + startFishingArea + " and " + endFishingArea + " based on startLatitude " + catchResult.startLatitude + " and endLatitude: " + catchResult.endLatitude,
                        "createdDate": moment().format(),
                        "createdBy": "TripsApi",
                        "tripNum": tripNum,
                        "haulNum": catchResult.haulNum
                    };
                    await masterDev.bulk({ docs: [groupingError, fishingAreaError] });
                } else if (source === 'logbook') {
                    await masterDev.bulk({ docs: [groupingError] });
                }
            } else if ((startFishingArea !== endFishingArea) && source === 'logbook') {
                let newAreaCatch = cloneDeep(catchResult);
                newAreaCatch.fishingArea = endFishingArea;
                splitGroupings.push(newAreaCatch);
                const fishingAreaError = {
                    "type": "boatnet-error",
                    "context": source +  "- Fishing Areas",
                    "error": catchResult.wcgopSpeciesCode + " catch split into 2 fishing areas: " + startFishingArea + " and " + endFishingArea + " based on startLatitude " + catchResult.startLatitude + " and endLatitude: " + catchResult.endLatitude,
                    "createdDate": moment().format(),
                    "createdBy": "TripsApi",
                    "tripNum": tripNum,
                    "haulNum": catchResult.haulNum
                }
                await masterDev.bulk({ docs: [fishingAreaError] });
            }
            ifqHaulLevelData.push(catchResult);
        }
        ifqHaulLevelData.push.apply(ifqHaulLevelData, splitGroupings);
    }

    // agg at haul level by ifqGrouping and disposition
    const uniqHauls = uniqBy(ifqHaulLevelData, (catchResult) => {
        return catchResult.ifqGrouping + catchResult.disposition + catchResult.haulNum + catchResult.fishingArea
    })
    const resultHauls = [];
    for (const haul of uniqHauls) {
        let initWeight = 0;
        const grouping = ifqHaulLevelData.filter((haulVal) =>
            haulVal.ifqGrouping === haul.ifqGrouping && haulVal.disposition === haul.disposition && haulVal.haulNum === haul.haulNum && haulVal.fishingArea === haul.fishingArea
        );
        const totalWeight = grouping.reduce((accumulator, currentValue) => {
            if (typeof currentValue.speciesWeight === 'number') {
                return accumulator + currentValue.speciesWeight;
            }
        }, initWeight);
        resultHauls.push({
            ifqGrouping: haul.ifqGrouping,
            disposition: haul.disposition,
            speciesWeight: totalWeight,
            haulNum: haul.haulNum,
            fishingArea: haul.fishingArea,
            speciesGroupId: haul.speciesGroupId
        })
    }

    return resultHauls;
}

function setTripLevelData(catchResults: any[]) {
    const ifqDispositionGroup = uniqBy(catchResults, (catchResult) => {
        return catchResult.ifqGrouping + catchResult.disposition + catchResult.fishingArea
    })
    const tripLevelData = [];
    for (const group of ifqDispositionGroup) {
        let initWeight = 0;
        const grouping = catchResults.filter((haulVal) =>
            haulVal.ifqGrouping === group.ifqGrouping && haulVal.disposition === group.disposition && haulVal.fishingArea === group.fishingArea
        );
        const totalWeight = grouping.reduce((accumulator, currentValue) => {
            if (typeof currentValue.speciesWeight === 'number') {
                return accumulator + currentValue.speciesWeight;
            }
        }, initWeight);
        tripLevelData.push({
            ifqGrouping: group.ifqGrouping,
            disposition: group.disposition,
            speciesWeight: totalWeight,
            fishingArea: group.fishingArea,
            speciesGroupId: group.speciesGroupId
        })
    }
    return tripLevelData;
}

function setIFQTripReporting(catchResult: CatchResults) {
    const resultsArr: any[] = [];

    let allRecords = catchResult.ifqLogbookTripLevel.concat(catchResult.ifqThirdPartyReviewTripLevel);
    const ifqGroupings = uniqBy(allRecords, (record: any) => {
        return record.ifqGrouping + record.disposition + record.fishingArea
    })
    for (const grouping of ifqGroupings) {
        if (grouping.disposition === Disposition.DISCARDED) {
            const emCatch = catchResult.ifqThirdPartyReviewTripLevel.filter((catchVal: any) => {
                if (grouping.ifqGrouping === catchVal.ifqGrouping && catchVal.disposition === Disposition.DISCARDED && grouping.fishingArea === catchVal.fishingArea) {
                    return catchVal;
                }
            });
            const logbookCatch = catchResult.ifqLogbookTripLevel.filter((catchVal: any) => {
                if (grouping.ifqGrouping === catchVal.ifqGrouping && catchVal.disposition === Disposition.DISCARDED && grouping.fishingArea === catchVal.fishingArea) {
                    return catchVal;
                }
            });
            const debitSource = selectDebitSource(emCatch[0], logbookCatch[0]);
            resultsArr.push(debitSource);
        } else {
            resultsArr.push(grouping);
        }
    }
    return resultsArr;
}

// TODO still need to implemented all the logic as specified in business rules
function selectDebitSource(emCatch, logbookCatch) {
    const emWeight = emCatch && emCatch.speciesWeight ? emCatch.speciesWeight : 0;
    const logbookWeight = logbookCatch && logbookCatch.speciesWeight ? logbookCatch.speciesWeight : 0;

    const difference = Math.abs(emWeight - logbookWeight);
    const tenPercentOfEM = .1 * emWeight;

    // based off EM business rules
    if (emWeight === 0) {
        return logbookCatch;
    } else if (logbookWeight === 0) {
        return emCatch;
    } else if (emWeight > 0 && logbookWeight > 0) {
        if (difference <= tenPercentOfEM) {
            return logbookCatch;
        } else {
            return emWeight > logbookWeight ? emCatch : logbookCatch;
        }
    }
}

function gradeLogbook(result) {
    if (result.type === MinimalResponseCatchTypeName) {
        console.log(JSON.stringify(result.ifqThirdPartyReviewCatchHaulLevel))

        const reviewedHaulNums = result.ifqThirdPartyReviewCatchHaulLevel.map( (row) => row.haulNum);
        const reviewedIfqGroupings = result.ifqThirdPartyReviewCatchHaulLevel.map( (row) => row.ifqGrouping);
        const logbookIfqCatchMatchedHauls = result.ifqLogbookCatchHaulLevel.filter( (row) => reviewedHaulNums.includes(row.haulNum) );

        const reviewedGroupingTotals = [];

        for (const grouping of reviewedIfqGroupings) {
            const groupingFilteredReviewCatch = result.ifqThirdPartyReviewCatchHaulLevel.filter( (row) => row.ifqGrouping === grouping && row.disposition === 'Discarded');
            const groupingFilteredLogbookCatch = logbookIfqCatchMatchedHauls.filter( (row) => row.ifqGrouping === grouping && row.disposition === 'Discarded');
            reviewedGroupingTotals.push(
                {
                    grouping,
                    logbook: sumBy(groupingFilteredLogbookCatch, 'speciesWeight'),
                    review: sumBy(groupingFilteredReviewCatch, 'speciesWeight')
                }
            )
        }
        for (let grouping of reviewedGroupingTotals) {
            if (!grouping.review) {
                console.log('grouping not in review - passing species');
                grouping.grade = 'pass';
                grouping.criteria = 'On LB only';
            } else if (grouping.review && !grouping.logbook) {
                if (['Cowcod rockfish', 'Yelloweye Rockfish'].includes(grouping)) {
                    if (grouping.review <= 2) {
                        console.log('grouping in review / not in logbook, and under 2 lbs - passing grouping');
                        grouping.grade = 'pass';
                        grouping.criteria = 'REV only + <= 2 lb';
                    } else {
                        console.log('grouping in review / not in logbook, and 2 or more lbs - failing grouping');
                        grouping.grade = 'fail';
                        grouping.criteria = 'REV only + > 2 lb';
                    }
                } else {
                    if (grouping.review <= 5) {
                        console.log('grouping in review / not in logbook, and under 5 lbs - passing grouping');
                        grouping.grade = 'pass';
                        grouping.criteria = 'REV only + <= 5 lb';
                    } else {
                        console.log('grouping in review / not in logbook, and 5 or more lbs - failing grouping');
                        grouping.grade = 'fail';
                        grouping.criteria = 'REV only + > 5 lb';
                    }
                }
        } else if (grouping.review && grouping.logbook) {
            if (grouping.logbook >= grouping.review) {
                console.log('grouping logbook weight greater than or equal to review weight - passing grouping')
                grouping.grade = 'pass';
                grouping.criteria = 'LB >= REV';
            } else {
                if (['Cowcod rockfish', 'Yelloweye Rockfish'].includes(grouping)) {
                    if (
                        grouping.review - grouping.logbook <= 2
                        || (Math.abs(grouping.logbook - grouping.review) <= (10 / 100 * grouping.review))
                        ) {
                            console.log('logbook weight is less than review weight, but less than 2 lbs or 10% of EM - passing grouping');
                            grouping.grade = 'pass';
                            grouping.criteria = 'LB < REV, < 2 lb or 10% of REV';
                    } else {
                        console.log('logbook weight is less than review weight and exceeds 2 lbs or 10% of EM - failing grouping');
                        grouping.grade = 'fail';
                        grouping.criteria = 'LB < REV, > 2 lb or 10% of REV';
                    }
                } else {
                    if (
                        grouping.review - grouping.logbook <= 5
                        || (Math.abs(grouping.logbook - grouping.review) <= (25 / 100 * grouping.review))
                        ) {
                            console.log('logbook weight is less than review weight, but less than 5 lbs or 25% of EM - passing grouping');
                            grouping.grade = 'pass';
                            grouping.criteria = "LB < REV, < 5 lb or 25% of REV";
                    } else {
                        console.log('logbook weight is less than review weight and exceeds 5 lbs or 25% of EM - failing grouping');
                        grouping.grade = 'fail';
                        grouping.criteria = "LB < REV, > 5 lb or 25% of REV";
                    }
                }
            }
        }
    }
        result.reviewedGroupingTotals = reviewedGroupingTotals;
        result.logbookGrade = reviewedGroupingTotals.find( (row) => row.grade === 'fail') ? 'fail' : 'pass';
    }

    return result;
}
