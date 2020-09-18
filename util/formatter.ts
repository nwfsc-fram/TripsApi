import { Catches, CatchResults, ResponseCatchTypeName, Disposition, sourceType } from '@boatnet/bn-models';
import { set, get, uniqBy } from 'lodash';

const dbConfig = require('../dbConfig.json').dbConfig;
const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev');

export async function format(logbook: Catches, review: Catches, audit: Catches) {
    let result: CatchResults = {
        type: ResponseCatchTypeName,
        tripNum: logbook.tripNum,
        updatedBy: logbook.updatedBy
    };
    const logbookCatch: any[] = catchToHaul(logbook);
    const reviewCatch: any[] = catchToHaul(review);
    const auditCatch: any[] = catchToHaul(audit);
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

function catchToHaul(catchVals: Catches) {
    const results: any[] = [];

    for (const haul of get(catchVals, 'hauls', [])) {
        for (const catchVal of get(haul, 'catch', [])) {
            const count = catchVal.speciesCount ? catchVal.speciesCode : null;
            results.push({
                disposition: catchVal.disposition,
                haulNum: haul.haulNum,
                weight: catchVal.weight,
                count,
                speciesCode: catchVal.speciesCode,
                wcgopSpeciesCode: catchVal.wcgopSpeciesCode, // TODO reference view to populate this
                // TODO populate docId from view (the field beth requested)
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
    // get ifq grouping name for each record
    for (let i = 0; i < catchResults.length; i++) {
        const ifqGrouping = await masterDev.view('Ifq', 'wcgop-codes-to-ifq-grouping',
            { "key": catchResults[i].wcgopSpeciesCode, "include_docs": false });
        set(catchResults[i], 'ifqGrouping', ifqGrouping.rows[0].value);
    }

    // agg at haul level by ifqGrouping and disposition
    const uniqHauls = uniqBy(catchResults, (catchResult) => {
        return catchResult.ifqGrouping + catchResult.disposition + catchResult.haulNum
    })
    const resultHauls = [];
    for (const haul of uniqHauls) {
        let initWeight = 0;
        const grouping = catchResults.filter((haulVal) =>
            haulVal.ifqGrouping === haul.ifqGrouping && haulVal.disposition === haul.disposition && haulVal.haulNum === haul.haulNum
        );
        const totalWeight = grouping.reduce((accumulator, currentValue) => {
            if (typeof currentValue.weight === 'number') {
                return accumulator + currentValue.weight;
            }
        }, initWeight);
        resultHauls.push({
            ifqGrouping: haul.ifqGrouping,
            disposition: haul.disposition,
            weight: totalWeight,
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
            if (typeof currentValue.weight === 'number') {
                return accumulator + currentValue.weight;
            }
        }, initWeight);
        tripLevelData.push({
            ifqGrouping: group.ifqGrouping,
            disposition: group.disposition,
            weight: totalWeight
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
    for(const grouping of ifqGroupings) {
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
    const emWeight = emCatch && emCatch.weight ? emCatch.weight : 0;
    const logbookWeight = logbookCatch && logbookCatch.weight ? logbookCatch.weight : 0;

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
