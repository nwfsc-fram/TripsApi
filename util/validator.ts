import { Catches, sourceType, errorType } from "@boatnet/bn-models/lib";
import { getFishTicket } from './oracle_routines';
import { get, set, flattenDeep, merge } from 'lodash';
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

validate.validators.isEmpty = function (value, options) {
    if (value) {
        return options;
    }
    return undefined;
};

export async function validateCatch(catchVal: Catches) {
    let errors: any[] = [];
    const source = catchVal.source;
    const emCodes = await masterDev.view('em-views', 'wcgopCode-to-pacfinCode-map', { include_docs: true });

    let validationResults: string = await validateTrip(catchVal);
    //validationResults += await validateFishTickets(catchVal, emCodes);
    errors = errors.concat(await getTripErrors(catchVal));

    let hauls = get(catchVal, 'hauls', []);
    for (let i = 0; i < hauls.length; i++) {
        validationResults += await validateHaul(hauls[i]);
        errors = errors.concat(getHaulErrors(hauls[i], source));
        let catches = get(hauls[i], 'catch', []);

        for (let j = 0; j < catches.length; j++) {
            let currCatchVal = catches[j];
            // convert speices codes supplied as string numbers to numbers
            const speciesCodeStr = parseInt(currCatchVal.speciesCode, 10);
            if (speciesCodeStr) {
                set(currCatchVal, 'speciesCode', speciesCodeStr);
                set(catchVal, 'hauls[' + i + '].catch[' + j + ']', currCatchVal);
            }
            const catchValResults = await validateCatchVal(currCatchVal, emCodes.rows);
            errors = errors.concat(catchErrors(currCatchVal, source, hauls[i].haulNum));
            if (catchValResults.length > 0) {
                validationResults += '\nCatch level errors: ' + hauls[i].haulNum + ' catch: ' + currCatchVal.catchId + catchValResults;
            }
        }
    }
    if (validationResults.length > 0) {
        return {
            catchVal,
            status: 400,
            message: validationResults
        }
    }
    set(catchVal, 'errors', errors);
    return {
        catchVal,
        status: 200
    };
}

/**
 * Gets errors logged in the catch document. This request is still
 * accepted and marked as valid
 */
async function getTripErrors(catchVal: Catches) {
    let errorsChecks = {
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
    if (vesselInfo[0]) {
        const captains: any = await masterDev.fetch({ keys: vesselInfo[0].authorizedPeople });
        let captainNames: string[] = [];
        if (captains && captains.rows && captains.rows.length > 0) {
            for (let captain of captains.rows) {
                captainNames.push(captain.doc.firstName + ' ' + captain.doc.lastName)
            }
            errorsChecks['skipperName'] = {
                inclusion: {
                    within: captainNames,
                    message: catchVal.skipperName + ' does not match one of the valid skipper names: ' + captainNames
                }
            }
        }
    }
    let errors = validate(catchVal, errorsChecks);

    // validate fish tickets, check each has a date and # associated with it
    if (catchVal.source === sourceType.logbook && catchVal.fishTickets) {
        for (let fishTicket of catchVal.fishTickets) {
            const index = catchVal.fishTickets.indexOf(fishTicket);
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
            errors = fishTicketErrors ? merge(errors, fishTicketErrors) : errors;
        }
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

/**
 * If an error is flagged here the request is rejected and no futher processing
 * is completed
 */
async function validateFishTickets(catchVal: Catches, speciesCodes: any) {
    let errors: string = '';
    if (catchVal.source === sourceType.logbook) {
        const validCodes = jp.query(speciesCodes, '$..value');

        for (const fishTicket of catchVal.fishTickets) {
            let dbTickets = await getFishTicket(fishTicket.fishTicketNumber);
            for (const dbTicket of dbTickets) {
                const validationResults = validate(dbTicket, {
                    PACFIN_SPECIES_CODE: {
                        inclusion: {
                            within: validCodes,
                            message: '%{value} which maps to fish ticket ' + fishTicket.fishTicketNumber + ' is invalid'
                        }
                    }
                });
                if (validationResults) {
                    errors = errors.concat(JSON.stringify(validationResults));
                }
            }
        }
    }
    return errors ? 'fish ticket errors: ' + errors : '';
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
            presence: true,
            numericality: {
                lessThan: 0
            }
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
            presence: true,
            numericality: {
                lessThan: 0
            }
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

async function validateCatchVal(catches: any, speciesCodes: any) {
    // TODO in species code may want to check isNumber for logbook and isString for review 
    const dispositionLookups = await getLookupList('catch-disposition');
    const validCodes = jp.query(speciesCodes, '$..value');
    const catchLevelChecks = {
        disposition: {
            presence: true,
            inclusion: {
                within: dispositionLookups,
                message: 'invalid, disposition must be either ' + dispositionLookups
            }
        },
        speciesCode: {
            presence: true,
            inclusion: {
                within: validCodes
            }
        },
        timeOnDeck: function (value, attributes) {
            if (["PHLB", '101'].includes(attributes.speciesCode)) {
                return {
                    presence: true
                }
            } else {
                return {
                    isEmpty: ' field should be left empty except when species is of type PHLB'
                }
            }
        },
    };
    // if priority or protected species verify count is present
    const speciesInfo = speciesCodes.filter((species) => species.value === catches.speciesCode);
    if (speciesInfo.length > 0 && speciesInfo[0] && speciesInfo[0].doc) {
        if (speciesInfo[0].doc.isProtected || speciesInfo[0].doc.isWcgopEmPriority) {
            catchLevelChecks['speciesCount'] = {
                presence: true
            }
        }
    }
    const catchResults = validate(catches, catchLevelChecks);
    return catchResults ? JSON.stringify(catchResults) : '';
}

async function getLookupList(view: String) {
    const lookups = await masterDev.view('TripsApi', 'all_em_lookups', { key: view, include_docs: true });
    return jp.query(lookups, '$..lookupValue')
}

// common function to format errors then this will be called by trip, haul, and catch errors
function logErrors(errors: any, haulNum?: number, catchId?: number) {
    const formattedErrors: any[] = [];
    if (!errors) {
        return [];
    }

    for (const [key, value] of Object.entries(errors)) {
        formattedErrors.push({
            field: key,
            message: value[0],
            type: errorType.warning,
            haulNum,
            catchId
        })
    }
    return formattedErrors;
}
