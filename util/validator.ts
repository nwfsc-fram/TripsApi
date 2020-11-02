import { Catches, sourceType } from "@boatnet/bn-models/lib";
import { get, set, flattenDeep } from 'lodash';
import { masterDev } from './couchDB';
const moment = require('moment');
var validate = require("validate.js");
const jp = require('jsonpath');

validate.extend(validate.validators.datetime, {
    // The value is guaranteed not to be null or undefined but otherwise it
    // could be anything.
    parse: function (value, options) {
        return +moment.utc(value);
    },
    // Input is a unix timestamp
    format: function (value, options) {
        var format = options.dateOnly ? "YYYY-MM-DD" : "YYYY-MM-DD hh:mm:ss";
        return moment.utc(value).format(format);
    }
});

export async function validateCatch(catchVal: Catches) {
    let errors: any[] = [];
    const source = catchVal.source;
    let validationResults: string = await validateTrip(catchVal);
    errors = errors.concat(await getTripErrors(catchVal));

    let hauls = get(catchVal, 'hauls', []);
    for (let i = 0; i < hauls.length; i++) {
        validationResults += await validateHaul(hauls[i]);
        errors = errors.concat(getHaulErrors(hauls[i], source));
        let catches = get(hauls[i], 'catch', []);

        for (let j = 0; j < catches.length; j++) {
            let currCatchVal = catches[j];
            const catchValResults = await validateCatchVal(currCatchVal);
            errors = errors.concat(catchErrors(currCatchVal, source, hauls[i].haulNum));
            if (catchValResults.length > 0) {
                validationResults += '\nCatch level errors: ' + hauls[i].haulNum + ' catch: ' + currCatchVal.catchId + catchValResults;
            }
            let results = await priorityAndProtectedChecks(catchVal.hauls[i], currCatchVal);
            set(catchVal, 'hauls[' + i + '].catch[' + j + ']', results.currCatch);
            errors = errors.concat(results.errors);
        }
    }
    if (validationResults.length > 0) {
        return {
            catchVal,
            status: 500,
            message: validationResults
        }
    }
    set(catchVal, 'errors', errors);
    return {
        catchVal,
        status: 200
    };
}

async function getTripErrors(catchVal: Catches) {
    // get captains associated with vesselNum
    const queryOptions = {
        reduce: false,
        include_docs: true,
        key: 'vessel-permissions'
    };
    const vesselPermissions = await masterDev.view('obs_web', 'all_doc_types', queryOptions);
    let vesselAuthorizations = jp.query(vesselPermissions, '$..vesselAuthorizations');
    vesselAuthorizations = flattenDeep(vesselAuthorizations);
    const vesselInfo: any = vesselAuthorizations.filter((auth) => auth.vesselIdNum === catchVal.vesselNumber);
    const captains: any = await masterDev.fetch({ keys: vesselInfo[0].authorizedPeople });
    let captainNames: string[] = [];
    for (let captain of captains.rows) {
        captainNames.push(captain.doc.firstName + ' ' + captain.doc.lastName)
    }

    const errorsChecks = {
        skipperName: {
            inclusion: {
                within: captainNames,
                message: 'Skipper name does not match a valid skipper for vessel ' + catchVal.vesselNumber
            }
        },
        fishTickets: function (value, attributes) {
            if (attributes.source === sourceType.logbook) {
                return {
                    presence: true
                }
            }
        },
        reviewerName: function (value, attributes) {
            if (attributes.source === sourceType.thirdParty) {
                return {
                    presence: true
                }
            }
        },
        totalReviewTime: function (value, attributes) {
            if (attributes.source === sourceType.thirdParty) {
                return {
                    presence: true
                }
            }
        },
    }
    let errors = validate(catchVal, errorsChecks);

    // validate fish tickets, check each has a datea and # associated with it
    for (let fishTicket of catchVal.fishTickets) {
        const index = catchVal.fishTickets.indexOf(fishTicket)
        const fishTicketChecks = {
            fishTicketNumber: {
                presence: {
                    message: 'missing from ticket with date ' + fishTicket.fishTicketDate
                }
            },
            fishTicketDate: {
                presence: {
                    message: 'missing from ticket# ' + fishTicket.fishTicketNumber
                },
                datetime: {
                    message: fishTicket.fishTicketDate + ' is an invalid date'
                }
            }
        }
        const fishTicketErrors = validate(fishTicket, fishTicketChecks);
        errors = Object.assign(errors, fishTicketErrors);
    }
    return logErrors(errors);
}

function getHaulErrors(haul: any, source: sourceType) {
    const errorChecks = {
        catchHandlingPerformance: function (value, attributes) {
            if (source === sourceType.thirdParty) {
                return {
                    presence: true
                }
            }
        },
        systemPerformance: function (value, attributes) {
            if (source === sourceType.thirdParty) {
                return {
                    presence: true
                }
            }
        },
    }
    const validationErrors: any = validate(haul, errorChecks);
    return logErrors(validationErrors, haul.haulNum);
}

function catchErrors(catchVal: any, source: sourceType, haulNum: number) {
    const errorChecks = {
        fate: function (value, attributes) {
            if (source === sourceType.thirdParty) {
                return {
                    presence: true
                }
            }
        }
    }
    const validationErrors: any = validate(catchVal, errorChecks);
    return logErrors(validationErrors, haulNum, catchVal.catchId);
}

async function validateTrip(catchVal: Catches) {
    const sourceLookups = await getLookupList('em-source');
    const fisheryLookups = await getLookupList('fishery');
    const fisherySectorLookups = await getLookupList('fishery-sector');

    const validationChecks = {
        tripNum: {
            presence: true
        },
        source: {
            presence: true,
            inclusion: {
                within: sourceLookups,
                message: 'of type ' + catchVal.source + ' invalid, accepted values: ' + sourceLookups
            }
        },
        fishery: function (value, attributes) {
            if (attributes.source === sourceType.logbook) {
                return {
                    presence: true,
                    inclusion: {
                        within: fisheryLookups,
                        message: 'invalid, valid fisheries include ' + fisheryLookups
                    }
                }
            }
        },
        fisherySector: function (value, attributes) {
            if (attributes.source === sourceType.thirdParty) {
                return {
                    presence: true,
                    inclusion: {
                        within: fisherySectorLookups,
                        message: 'invalid, valid fishery sectors include ' + fisherySectorLookups
                    }
                }
            }
        },
        provider: {
            presence: true
        },
        departureDateTime: {
            datetime: {
                latest: catchVal.returnDateTime,
                message: 'must occur before Return Date'
            }
        }
    };
    const tripResults = validate(catchVal, validationChecks);

    return tripResults ? 'trip level errors: ' + JSON.stringify(tripResults) : '';
}

async function validateHaul(haul: any) {
    const gearLookups = await getLookupList('gear-type');
    const gearGroup1 = ["10", "19", "20"];
    const gearGroup2 = ["1", "2", "3", "4", "5"];

    const haulLevelChecks = {
        haulNum: {
            presence: true
        },
        gearTypeCode: {
            presence: true,
            inclusion: {
                within: gearLookups,
                message: 'of ' + haul.gearTypeCode + ' is invalid, accepted values are ' + gearLookups
            }
        },
        gearPerSet: function (value, attributes) {
            if (gearGroup1.includes(attributes.gearTypeCode)) {
                return {
                    presence: true
                }
            }
        },
        gearLost: function (value, attributes) {
            if (gearGroup1.includes(attributes.gearTypeCode)) {
                return {
                    presence: true
                }
            }
        },
        avgHooksPerSeg: function (value, attributes) {
            if (gearGroup1.includes(attributes.gearTypeCode)) {
                return {
                    presence: true
                }
            }
        },
        netType: function (value, attributes) {
            if (gearGroup2.includes(attributes.gearTypeCode)) {
                return {
                    presence: true
                }
            }
        },
        codendCapacity: function (value, attributes) {
            if (gearGroup2.includes(attributes.gearTypeCode)) {
                return {
                    presence: true
                }
            }
        },
        isCodendLost: function (value, attributes) {
            if (gearGroup2.includes(attributes.gearTypeCode)) {
                return {
                    presence: true
                }
            }
        },
        startDepth: function (value, attributes) {
            if (attributes.source === sourceType.logbook) {
                return {
                    presence: true
                }
            }
        },
        startLongitude: {
            presence: true
        },
        startLatitude: {
            presence: true,
            numericality: {
                lessThan: 49
            }
        },
        endDepth: function (value, attributes) {
            if (attributes.source === sourceType.logbook) {
                return {
                    presence: true
                }
            }
        },
        endLongitude: {
            presence: true
        },
        endLatitude: {
            presence: true,
            numericality: {
                lessThan: 49
            }
        }
    };
    const haulResults = validate(haul, haulLevelChecks);
    return haulResults ? '\nHaul level errors: ' + haul.haulNum + ' ' + JSON.stringify(haulResults) : '';
}

async function validateCatchVal(catches: any) {
    const dispositionLookups = await getLookupList('catch-disposition');
    const catchLevelChecks = {
        disposition: {
            presence: true,
            inclusion: {
                within: dispositionLookups,
                message: 'invalid, disposition must be either ' + dispositionLookups
            }
        },
        speciesCode: {
            presence: true
        },
        timeOnDeck: function (value, attributes) {
            if (["PHLB", 101].includes(attributes.speciesCode)) {
                return {
                    presence: true
                }
            }
        },
    };
    const catchResults = validate(catches, catchLevelChecks);
    return catchResults ? JSON.stringify(catchResults) : '';
}

// common function to format errors then this will be called by trip, haul, and catch errors

async function getLookupList(view: String) {
    const lookups = await masterDev.view('TripsApi', 'all_em_lookups', { key: view, include_docs: true });
    return jp.query(lookups, '$..lookupValue')
}

function logErrors(errors: any, haulNum?: number, catchId?: number) {
    const formattedErrors: any[] = [];

    for (const [key, value] of Object.entries(errors)) {
        formattedErrors.push({
            field: key,
            message: value,
            haulNum,
            catchId
        })
    }
    return formattedErrors;
}

// priority and protected species must have weight and count
async function priorityAndProtectedChecks(haul: any, currCatch: any) {
    const options = {
        include_docs: true,
        key: currCatch.speciesCode
    };
    const source = currCatch.source;
    let lookupInfo = await masterDev.view('em-views', 'wcgopCode-to-pacfinCode-map', options);
    let errors = [];
    if (lookupInfo.rows.length > 0) {  // handles the possibility that the species code isn't returned by the codes-map view
        lookupInfo = lookupInfo.rows[0].doc;
    }

    if (lookupInfo.isProtected || lookupInfo.isWcgopEmPriority) {
        currCatch.isProtected = lookupInfo.isProtected ? true : false;
        currCatch.isWcgopEmPriority = lookupInfo.isWcgopEmPriority ? true : false;
        if (!currCatch.speciesCount) {
            errors.push({
                type: 'Missing count',
                haulNum: haul.haulNum,
                catchId: currCatch.catchId
            });
        }
        // add error when species code is not format expected by source
        if (source === 'logbook' && parseInt(currCatch.speciesCode, 10)) {
            errors.push({
                type: 'Unexpected code',
                message: 'expected Pacfin code, but got numeric code: ' + currCatch.speciesCode
            })
        } else if (source === 'thirdParty' && !parseInt(currCatch.speciesCode, 10)) {
            errors.push({
                type: 'Missing weight',
                haulNum: haul.haulNum,
                catchId: currCatch.catchId
            });
        }

    }
    return { currCatch, errors };
}
