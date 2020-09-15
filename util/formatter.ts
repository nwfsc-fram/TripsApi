import { Catches, CatchResults, ResponseCatchTypeName } from '@boatnet/bn-models';
import { set, get } from 'lodash';

export function format(logbook: Catches, review: Catches, audit: Catches) :CatchResults {
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
