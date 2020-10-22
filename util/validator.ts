import { Catches, sourceType } from "@boatnet/bn-models/lib";
import { get, set } from 'lodash';
import { masterDev } from './couchDB';

export async function validateCatch(catchVal: Catches) {
    let errors: any[] = [];

    // validate sourceType
    if (![sourceType.thirdParty, sourceType.nwfscAudit, sourceType.logbook].includes(catchVal.source)) {
        return {
            catchVal,
            status: 500,
            message: 'Invalid source: ' + catchVal.source + '. Accepted source values are:' +
                'thirdParty, nwfscAudit, and logbook. Please correct source and try again.'
        };
    }

    let hauls = get(catchVal, 'hauls', []);
    for (let i = 0; i < hauls.length; i++) {
        let catches = get(hauls[i], 'catch', []);
        for (let j = 0; j < catches.length; j++) {
            let currCatchVal = catchVal.hauls[i].catch[j];

            let results = await priorityAndProtectedChecks(currCatchVal);
            currCatchVal = results.currCatch;
            errors = errors.concat(results.errors);
        }
    }
    set(catchVal, 'errors', errors);
    return {
        catchVal,
        status: 200
    };
}

// priority and protected species must have weight and count
async function priorityAndProtectedChecks(currCatch: any) {
    const options = {
        include_docs: true,
        key: parseInt(currCatch.speciesCode, 10) ? parseInt(currCatch.speciesCode, 10) : currCatch.speciesCode
    };
    let lookupInfo = await masterDev.view('em-views', 'wcgopCode-to-pacfinCode-map', options);
    console.log(lookupInfo)
    let errors = [];
    if (lookupInfo.rows.length > 0) {
        lookupInfo = lookupInfo.rows[0].doc;

        if (lookupInfo.isProtected || lookupInfo.isWcgopEmPriority) {
            currCatch.isProtected = lookupInfo.isProtected ? true : false;
            currCatch.isWcgopEmPriority = lookupInfo.isWcgopEmPriority ? true : false;
            if (!currCatch.speciesCount) {
                errors.push({
                    type: 'Missing count',
                    message: 'CatchId ' + currCatch.catchId + ' missing count'
                });
            }
            if (!currCatch.weight) {
                errors.push({
                    type: 'Missing weight',
                    message: 'CatchId ' + currCatch.catchId + ' missing weight'
                });
            }
        }
    } else {
        errors.push({
            type: 'Unlisted Species Code (invalid?)',
            message: 'CatchId ' + currCatch.catchId + ' unlisted species code (invalid?)'
        });
    }
    return { currCatch, errors };
}
