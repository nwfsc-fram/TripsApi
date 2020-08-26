import { Catches, CatchResults, ResponseCatchTypeName } from '@boatnet/bn-models';
import moment from 'moment';
import { set, get } from 'lodash';

export function formatLogbook(logbook: Catches): CatchResults {
    let result: CatchResults = {
        type: ResponseCatchTypeName,
        tripNum: logbook.tripNum
    };
    const logbookCatch: any[] = catchToHaul(logbook);
    set(result, 'logbookCatch', logbookCatch);
    return result;
}

export function formatLogbookAndReview(logbook: Catches, review: Catches) :CatchResults {
    let result = formatLogbook(logbook);
    const reviewCatch: any[] = catchToHaul(review);
    set(result, 'thirdPartyReviewCatch', reviewCatch);
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
               // createDate: moment().format()
            })
        }
    }
    return results;
}
