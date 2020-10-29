import { Catches, CatchResults, ResponseCatchTypeName, Disposition, sourceType } from '@boatnet/bn-models';
import { set, get, uniqBy } from 'lodash';
import { masterDev } from './couchDB';

export async function format(logbook: Catches, review: Catches, audit: Catches) {
    let result: CatchResults = {
        type: ResponseCatchTypeName,
        tripNum: logbook.tripNum,
        updatedBy: logbook.updatedBy
    };
    const logbookCatch: any[] = await catchToHaul(logbook);
    const reviewCatch: any[] = await catchToHaul(review);
    const auditCatch: any[] = await catchToHaul(audit);
    set(result, 'logbookCatch', logbookCatch);
    set(result, 'thirdPartyReviewCatch', reviewCatch);
    set(result, 'nwfscAuditCatch', auditCatch);

    const ifqLogbookCatchHaulLevel = await setIFQHaulLevelData(result.logbookCatch);
    const ifqThirdPartyReviewCatchHaulLevel = await setIFQHaulLevelData(result.thirdPartyReviewCatch);
    const ifqNwfscAuditHaulLevel = await setIFQHaulLevelData(result.nwfscAuditCatch);
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

    return result;
}

async function catchToHaul(catchVals: Catches) {
    const results: any[] = [];
    let pacfinSpeciesCode = "";
    let wcgopSpeciesCode = "";

    for (const haul of get(catchVals, 'hauls', [])) {
        for (const catchVal of get(haul, 'catch', [])) {
            const count = catchVal.speciesCount ? catchVal.speciesCount : null;

            const speciesCode = parseInt(catchVal.speciesCode) ? parseInt(catchVal.speciesCode) : catchVal.speciesCode;
            // lookup code to get pacfinSpeciesCode, wcgopSpeciesCode, and docId
            const codeLookup = await masterDev.view('em-views', 'wcgopCode-to-pacfinCode-map',
                { "key": speciesCode, "include_docs": false });
            if (typeof codeLookup.rows[0].key === 'string') {
                pacfinSpeciesCode = codeLookup.rows[0].key;
                wcgopSpeciesCode = codeLookup.rows[0].value;
            } else {
                pacfinSpeciesCode = codeLookup.rows[0].value;
                wcgopSpeciesCode = codeLookup.rows[0].key;
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
                gearType: haul.gearTypeCode,
                fisherySector: catchVals.fisherySector,
                // fishery
                // ifqSpeciesGroupName
                // fishingArea
            })
        }
    }
    return results;
}

async function setIFQHaulLevelData(catchResults: any[]) {
    // get ifq grouping name for each record based speciesCode and lat and long
    const ifqHaulLevelData: any[] = [];
    for (const catchResult of catchResults) {
        const ifqGroupings = await masterDev.view('Ifq', 'speciesCode-to-ifq-grouping',
            { "key": catchResult.wcgopSpeciesCode, "include_docs": true });
        if (ifqGroupings.rows.length > 1) {
            let groupName: string = '';
            for (const ifqGrouping of ifqGroupings.rows) {
                const lowerLat = ifqGrouping.doc.regulationAreas[0].lowerLatitude;
                const upperLat = ifqGrouping.doc.regulationAreas[0].upperLatitude;
                const startLat = catchResult.startLatitude;
                const endLat = catchResult.endLatitude;

                if (lowerLat && upperLat && startLat > lowerLat && endLat > lowerLat && startLat < upperLat && endLat < upperLat) {
                    groupName = ifqGrouping.value;
                } else if (lowerLat && !upperLat && startLat > lowerLat && endLat > lowerLat) {
                    groupName = ifqGrouping.value;
                } else if (!lowerLat && upperLat && startLat < upperLat && endLat < upperLat) {
                    groupName = ifqGrouping.value;
                }
            }
            if (groupName.length !== 0) {
                catchResult.ifqGrouping = groupName;
                ifqHaulLevelData.push(catchResult);
            }
        } else {
            if (ifqGroupings.rows[0] && ifqGroupings.rows[0].value) {
                catchResult.ifqGrouping = ifqGroupings.rows[0].value;
                ifqHaulLevelData.push(catchResult);
            }
        }
    }

    // agg at haul level by ifqGrouping and disposition
    const uniqHauls = uniqBy(ifqHaulLevelData, (catchResult) => {
        return catchResult.ifqGrouping + catchResult.disposition + catchResult.haulNum
    })
    const resultHauls = [];
    for (const haul of uniqHauls) {
        let initWeight = 0;
        const grouping = ifqHaulLevelData.filter((haulVal) =>
            haulVal.ifqGrouping === haul.ifqGrouping && haulVal.disposition === haul.disposition && haulVal.haulNum === haul.haulNum
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
            haulNum: haul.haulNum
        })
    }
    return resultHauls;
}

function setTripLevelData(catchResults: any[]) {
    const ifqDispositionGroup = uniqBy(catchResults, (catchResult) => {
        return catchResult.ifqGrouping + catchResult.disposition
    })
    const tripLevelData = [];
    for (const group of ifqDispositionGroup) {
        let initWeight = 0;
        const grouping = catchResults.filter((haulVal) =>
            haulVal.ifqGrouping === group.ifqGrouping && haulVal.disposition === group.disposition
        );
        const totalWeight = grouping.reduce((accumulator, currentValue) => {
            if (typeof currentValue.speciesWeight === 'number') {
                return accumulator + currentValue.speciesWeight;
            }
        }, initWeight);
        tripLevelData.push({
            ifqGrouping: group.ifqGrouping,
            disposition: group.disposition,
            speciesWeight: totalWeight
        })
    }
    return tripLevelData;
}

function setIFQTripReporting(catchResult: CatchResults) {
    const resultsArr: any[] = [];

    let allRecords = catchResult.ifqLogbookTripLevel.concat(catchResult.ifqThirdPartyReviewTripLevel);
    const ifqGroupings = uniqBy(allRecords, (record: any) => {
        return record.ifqGrouping + record.disposition
    })
    for (const grouping of ifqGroupings) {
        if (grouping.disposition === Disposition.DISCARDED) {
            const emCatch = catchResult.ifqThirdPartyReviewTripLevel.filter((catchVal) => {
                if (grouping.ifqGrouping === catchVal.ifqGrouping && catchVal.disposition === Disposition.DISCARDED) {
                    return catchVal;
                }
            });
            const logbookCatch = catchResult.ifqLogbookTripLevel.filter((catchVal) => {
                if (grouping.ifqGrouping === catchVal.ifqGrouping && catchVal.disposition === Disposition.DISCARDED) {
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
