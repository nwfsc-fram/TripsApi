import { Catches, sourceType, errorType, gearTypeLookupValueEnum } from "@boatnet/bn-models/lib";
import { getFishTicket } from './oracle_routines';
import { get, set, flattenDeep, merge } from 'lodash';
import { masterDev } from './couchDB';
const moment = require('moment');
var validate = require("validate.js");
const jp = require('jsonpath');

validate.extend(validate.validators.datetime, {
    parse: function (value, options) {
        return +moment.utc(value);
    },
    // Input is a unix timestamp
    format: function (value, options) {
        var format = options.dateOnly ? "YYYY-MM-DD" : "YYYY-MM-DD hh:mm:ss";
        return moment.utc(value).format(format);
    }
});

// checks whether an value is empty. Returns true if empty
validate.validators.isEmpty = function (value, options) {
    if (value) {
        return options;
    }
    return undefined;
};

const vesselIdCheck = async (vesselId?) => { // not implemented yet
    if (vesselId) {
        const vesselIdsQuery = await masterDev.view('obs_web', 'all_vessel_nums', {reduce: false, include_docs: false, key: vesselId});
        if (vesselIdsQuery.rows.length === 0) {
            return 'vesselId is not valid';
        }
    } else {
        return 'vesselId is required';
    }
};

const departureDateCheck = async (departureDate?) => { // not implemented yet
    if (departureDate && !isNaN(new Date(departureDate).getDate())) {
        return 'departure date is not a valid datetime'
    } else {
        return 'departure date is required';
    }
}

export async function validateApiTrip(apiTrip: any, mode: string) {

    const portsQuery = await masterDev.view('TripsApi', 'all_em_lookups', {reduce: false, include_docs: false, key: 'port'});
    const validPortCodes = portsQuery.rows.map( (row: any) => row.value[1] );

    const fisheriesQuery = await masterDev.view('obs_web', 'all_doc_types', {reduce: false, include_docs: true, key: 'fishery'});
    const validFisheryNames = fisheriesQuery.rows.map( (row: any) => row.doc.description );

    // check if vesselId valid
    const vesselIdsQuery = await masterDev.view('obs_web', 'all_vessel_nums', {reduce: false, include_docs: false, key: apiTrip.vesselId});
    const validVessel = vesselIdsQuery.rows.map( (row: any) => row.key );

    validate.validators.equality.message = 'invalid value';
    validate.validators.inclusion.message = 'not valid';

    const validations = {
        vesselId: function() {
            if (mode === 'new') {
                return {
                    presence: {allowEmpty: false},
                    inclusion: {
                        within: validVessel
                    }
                }
            }
        },
        departureDate: function() {
            if (mode === 'new') {
                return {
                    presence: {allowEmpty: false},
                    datetime: true
                }
            } else {
                return {
                    datetime: true
                }
            }
        },
        returnDate: function() {
            if (mode === 'new') {
                return {
                    presence: {allowEmpty: false},
                    datetime: true
                }
            } else {
                return {
                    datetime: true
                }
            }
        },
        status: {
            inclusion: {
                within: ["cancelled"]
            }
        },
        departurePort: {
            type: "string",
            inclusion: {
                within: validPortCodes,
            }
        },
        returnPort: {
            type: "string",
            inclusion: {
                within: validPortCodes,
            }
        },
        fishery: {
            type: "string",
            inclusion: {
                within: validFisheryNames,
            }
        },
        vesselName: {
            type: "string"
        },
        skipperName: {
            type: "string"
        }
    };

    return validate(apiTrip, validations);
}

export async function validateCatch(catchVal: Catches, tripNum: number, otsTrip?: any) {
    let errors: any[] = [];
    const source = catchVal.source;

    // Getting list of accepted speices code
    const emCodeDocs = await masterDev.view('em-views', 'wcgopCode-to-pacfinCode-map', { include_docs: true });
    const validCodes = jp.query(emCodeDocs, '$..key');

    // Adding nominal species codes to list of accepted species codes
    const nomDecoderSrc: any = await masterDev.view('obs_web', 'all_doc_types', { "reduce": false, "key": "nom-2-pacfin-decoder", "include_docs": true });
    for (const nomCode of nomDecoderSrc.rows[0].doc.decoder) {
        validCodes.push(nomCode['nom-code']);
    }

    // validate trip - find errors that would cause the request to be rejected
    let validationResults: string = await validateTrip(catchVal, tripNum);
    validationResults += await validateFishTickets(catchVal, validCodes);
    // find errors, the trip will still be accepted, but errors logged in the doc
    errors = errors.concat(await getTripErrors(catchVal, otsTrip));

    let hauls = get(catchVal, 'hauls', []);
    for (let i = 0; i < hauls.length; i++) {
        validationResults += await validateHaul(hauls[i], catchVal);
        errors = errors.concat(getHaulErrors(hauls[i], source));
        if (source === 'thirdParty') {
            const logbookQuery = await masterDev.view('TripsApi', 'all_api_catch', {"key": tripNum, "include_docs": true});
            const logbook = logbookQuery.rows.map( (row: any) => row.doc).find( (row: any) => row.source === 'logbook');
            if (logbook && logbook.hauls && hauls[i] && logbook.hauls[i]) {
                errors = errors.concat(await getHaulComparisonErrors(hauls[i], logbook.hauls[i]));
            }
        }

        let catches = get(hauls[i], 'catch', []);

        for (let j = 0; j < catches.length; j++) {
            let currCatchVal = catches[j];
            const catchValResults = await validateCatchVal(currCatchVal, emCodeDocs.rows, source);
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

async function getHaulComparisonErrors(reviewHaul, logbookHaul) {
    if (reviewHaul && logbookHaul && reviewHaul.gear !== logbookHaul.gear) {
        return {
            "field": "gear",
            "message": "EM gear '" + reviewHaul.gear + "' does not match Logbook gear '" + logbookHaul.gear + "'",
            "haulNum": reviewHaul.haulNum
        }
    }
}

/**
 * Gets errors logged in the catch document. This request is still
 * accepted and marked as valid
 */
async function getTripErrors(catchVal: Catches, otsTrip?: any) {
    let errorsChecks = {
        fishTickets: function (value, attributes) {
            if (attributes.source === sourceType.logbook) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        reviewerName: function (value, attributes) {
            if (attributes.source === sourceType.thirdParty) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        totalReviewTime: function (value, attributes) {
            if (attributes.source === sourceType.thirdParty) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        departureDateTime: function (value, attributes) {
            if (otsTrip) {
                return {
                    datetime: {
                        earliest: otsTrip.departureDate,
                        latest: otsTrip.returnDate,
                        message: 'outside of original trip dates.'
                    }
                }
            }
        },
        returnDateTime: function (value, attributes) {
            if (otsTrip) {
                return {
                    datetime: {
                        earliest: otsTrip.departureDate,
                        latest: otsTrip.returnDate,
                        message: 'outside of original trip dates.'
                    }
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
    let errors = {};
    errors = merge(errors, validate(catchVal, errorsChecks));

    // validate fish tickets, check each has a date and # associated with it
    if (catchVal.fishTickets) {
        for (let fishTicket of catchVal.fishTickets) {
            let ticketLookup = await getFishTicket(fishTicket.fishTicketNumber);
            if (ticketLookup.length === 0) {
                errors["fishTicketNumber"] = ['No fish ticket for ticket: ' + fishTicket.fishTicketNumber + ' found in the database.']
            }
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
                        earliest: catchVal.returnDateTime,
                        latest: moment(catchVal.returnDateTime).add(5, 'days'),
                        message: 'must be after return date and within 5 days.'
                    }
                }
            }
            const fishTicketErrors = validate(fishTicket, fishTicketChecks);
            errors = fishTicketErrors ? merge(errors, fishTicketErrors) : errors;
        }
    }

    const buyersQuery = await masterDev.view('obs_web', 'all_doc_types', {reduce: false, include_docs: true, key: 'buyer'});
    const validBuyers = buyersQuery.rows.map( (row: any) => row.doc.permit_number );

    if (catchVal.source === sourceType.thirdParty && catchVal.buyers) {
        for (const buyer of catchVal.buyers) {
            const buyerChecks = {
                buyer: {
                    inclusion: {
                        within: validBuyers,
                        message: '\'' + buyer + '\' is not a valid buyer lookup number'
                    }
                }
            }
            const buyerErrors = validate({buyer: buyer}, buyerChecks);
            errors = buyerErrors ? merge(errors, buyerErrors) : errors;
        }
    }

    return logErrors(errors);
}

function getHaulErrors(haul: any, source: sourceType) {
    const errorChecks = {
        catchHandlingPerformance: function (value, attributes) {
            if (source === sourceType.thirdParty) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        systemPerformance: function (value, attributes) {
            if (source === sourceType.thirdParty) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        netType: function (value, attributes) {
            if (attributes.gear === gearTypeLookupValueEnum.trawl) {
                return {
                    presence: {
                        allowEmpty: false,
                        message: 'required when gear = trawl'
                    }
                }
            }
        },
    }
    const validationErrors: any = validate(haul, errorChecks);

    if (haul.catch && haul.catch.length > 0 && haul.isCodendLost) {
        validationErrors.isCodendLost = ['Haul should not have catch when isLostCodend is true'];
    }

    return logErrors(validationErrors, haul.haulNum);
}

function catchErrors(catchVal: any, source: sourceType, haulNum: number) {
    const errorChecks = {
        // fate: function (value, attributes) {  --- moved to catch validation
        //     if (source === sourceType.thirdParty) {
        //         return {
        //             presence: {
        //                 allowEmpty: false,
        //                 message: 'required for review submission'
        //             }
        //         }
        //     }
        // }
    }
    const validationErrors: any = validate(catchVal, errorChecks);
    return logErrors(validationErrors, haulNum, catchVal.catchId);
}

/**
 * If an error is flagged here the request is rejected and no futher processing
 * is completed
 */
async function validateFishTickets(catchVal: Catches, speciesCodes: string[]) {
    let errors: string = '';
    if (catchVal.source === sourceType.logbook && catchVal.fishTickets) {
        for (const fishTicket of catchVal.fishTickets) {
            let dbTickets = await getFishTicket(fishTicket.fishTicketNumber);
            for (const dbTicket of dbTickets) {
                const validationResults = validate(dbTicket, {
                    PACFIN_SPECIES_CODE: {
                        inclusion: {
                            within: speciesCodes,
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

async function validateTrip(catchVal: Catches, tripNum: number) {

    const portsQuery = await masterDev.view('TripsApi', 'all_em_lookups', {reduce: false, include_docs: false, key: 'port'});
    const validPortCodes = portsQuery.rows.map( (row: any) => row.value[1] );

    // check if vesselId valid
    const vesselIdsQuery = await masterDev.view('obs_web', 'all_vessel_nums', {reduce: false, include_docs: false, key: catchVal.vesselNumber});
    const validVessel = vesselIdsQuery.rows.map( (row: any) => row.key );

    const sourceLookups = await getLookupList('em-source');

    const fisheriesQuery = await masterDev.view('TripsApi', 'all_em_lookups', {reduce: false, include_docs: true, key: 'fishery'});
    const validFisheryNames = fisheriesQuery.rows.map( (row: any) => row.doc.description );
    const fisherySectorLookups = await getLookupList('fishery-sector');

    const validationChecks = {
        tripNum: {
            presence: {allowEmpty: false},
            inclusion: {
                within: [tripNum],
                message: catchVal.tripNum + ' in catch doc does match tripNum: ' + tripNum +  ' specified in request'
            }
        },
        source: {
            presence: {allowEmpty: false},
            inclusion: {
                within: sourceLookups,
                message: 'of type ' + catchVal.source + ' invalid, accepted values: ' + sourceLookups
            }
        },
        fishery: function (value, attributes) {
            if (attributes.source === sourceType.logbook) {
                return {
                    presence: {allowEmpty: false},
                    inclusion: {
                        within: validFisheryNames,
                        message: 'invalid, valid fisheries include ' + validFisheryNames
                    }
                }
            }
        },
        fisherySector: function (value, attributes) {
            if (attributes.source === sourceType.thirdParty) {
                return {
                    presence: {allowEmpty: false},
                    inclusion: {
                        within: fisherySectorLookups,
                        message: 'invalid, valid fishery sectors include ' + fisherySectorLookups
                    }
                }
            }
        },
        provider: {
            presence: {allowEmpty: false}
        },
        departureDateTime: {
            datetime: {
                latest: catchVal.returnDateTime,
                message: 'must occur before Return Date'
            },
            presence: {allowEmpty: false}
        },
        returnDateTime: {
            presence: {allowEmpty: false}
        },
        vesselNumber: {
            presence: {allowEmpty: false},
            inclusion: {
                within: validVessel
            }
        },
        vesselName: {
            type: "string",
            presence: {allowEmpty: false},
        },
        departurePortCode: {
            presence: {allowEmpty: false},
            type: "string",
            inclusion: {
                within: validPortCodes,
            }
        },
        returnPortCode: {
            presence: {allowEmpty: false},
            type: "string",
            inclusion: {
                within: validPortCodes,
            }
        },
        skipperName: {
            presence: {allowEmpty: false},
            type: "string"
        },
        permitNumber: {
            presence: {allowEmpty: false},
            type: "string"
        }
    };
    const tripResults = validate(catchVal, validationChecks);

    return tripResults ? 'trip level errors: ' + JSON.stringify(tripResults) : '';
}

async function validateHaul(haul: any, tripInfo: Catches) {
    const gearLookups = await getLookupList('gear');
    const gearGroup1 = ["fish pot", "hook & line", "longline (snap)"];
    const gearGroup2 = ["trawl"];

    const haulLevelChecks = {
        haulNum: {
            presence: {allowEmpty: false}
        },
        gear: {
            presence: {allowEmpty: false},
            inclusion: {
                within: gearLookups,
                message: 'of ' + haul.gear + ' is invalid, accepted values are ' + gearLookups
            }
        },
        // netType: function (value, attributes) {
        //     if (attributes.gear === gearTypeLookupValueEnum.trawl) {
        //         return {
        //             presence: {
        //                 allowEmpty: false,
        //                 message: 'required when gear = trawl'
        //             }
        //         }
        //     }
        // },
        gearPerSet: function (value, attributes) {
            if (gearGroup1.includes(attributes.gear)) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        gearLost: function (value, attributes) {
            if (gearGroup1.includes(attributes.gear)) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        avgHooksPerSeg: function (value, attributes) {
            if (gearGroup1.includes(attributes.gear)) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        codendCapacity: function (value, attributes) {
            if (gearGroup2.includes(attributes.gear)) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        isCodendLost: function (value, attributes) {
            if (gearGroup2.includes(attributes.gear)) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        startDepth: function (value, attributes) {
            if (attributes.source === sourceType.logbook) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        startDateTime: {
            datetime: {
                earliest: tripInfo.departureDateTime,
                latest: haul.endDateTime,
                message: 'must occur after trip departure date time: ' + tripInfo.departureDateTime + ' and before haul end date ' + haul.endDateTime
            },
            presence: {allowEmpty: false}
        },
        startLongitude: {
            presence: {allowEmpty: false},
            numericality: {
                lessThan: 0
            }
        },
        startLatitude: {
            presence: {allowEmpty: false},
            numericality: {
                lessThan: 49
            }
        },
        endDepth: function (value, attributes) {
            if (attributes.source === sourceType.logbook) {
                return {
                    presence: {allowEmpty: false}
                }
            }
        },
        endLongitude: {
            presence: {allowEmpty: false},
            numericality: {
                lessThan: 0
            }
        },
        endLatitude: {
            presence: {allowEmpty: false},
            numericality: {
                lessThan: 49
            }
        },
        endDateTime: {
            datetime: {
                latest: tripInfo.returnDateTime,
                message: 'must occur before trip return date time: ' + tripInfo.returnDateTime
            },
            presence: {allowEmpty: false}
        }
    };
    const haulResults = validate(haul, haulLevelChecks);
    return haulResults ? '\nHaul level errors: haul# ' + haul.haulNum + ' ' + JSON.stringify(haulResults) : '';
}

async function validateCatchVal(catches: any, speciesCodes: any, source?: any) {
    // TODO in species code may want to check isNumber for logbook and isString for review
    const dispositionLookups = await getLookupList('catch-disposition');
    const validCodes = jp.query(speciesCodes, '$..key').map( (row: any) => {
        if (parseInt(row, 10)) {
            return parseInt(row, 10);
        } else {
            return row;
        }
    });
    const catchLevelChecks = {
        disposition: {
            presence: {allowEmpty: false},
            inclusion: {
                within: dispositionLookups,
                message: 'invalid, disposition must be either ' + dispositionLookups
            }
        },
        speciesCode: {
            presence: {allowEmpty: false},
            inclusion: {
                within: validCodes,
                message: ' %{value} is invalid. (Note WCGOP codes must be numbers and PACFIN codes must be enclosed in quotes)'
            }
        },
        fate: function (value, attributes) {
            if (source === sourceType.thirdParty) {
                return {
                    presence: {
                        allowEmpty: false,
                        message: 'required for review submission'
                    }
                }
            }
        },
        speciesCount: function (value, attributes) {
            const index = validCodes.indexOf(attributes.speciesCode);
            if (index > 0 && (speciesCodes[index].doc.isProtected || speciesCodes[index].doc.isWcgopEmPriority)) {
                return { presence: { message: "is required for species code " + attributes.speciesCode } }
            }
        },
        timeOnDeck: function (value, attributes) {
            if (["PHLB", 101].includes(attributes.speciesCode) && source !== 'logbook') {
                return {
                    presence: {
                        message: ' should not be empty when species is of type ' + attributes.speciesCode
                    }
                }
            } else {
                return {
                    isEmpty: ' should be left empty except when species code is of type PHLB/101'
                }
            }
        },
    };
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
