import { Catches, Disposition, sourceType } from "@boatnet/bn-models/lib";
import { get, set } from 'lodash';
import { masterDev } from './couchDB';
const moment = require('moment');
var validate = require("validate.js");
const jp = require('jsonpath');

export async function validateCatch(catchVal: Catches) {
    let errors: any[] = [];
    let validationResults: string = '';

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

    let sourceLookups = await masterDev.view('TripsApi', 'all_em_lookups', { key: 'em-source', include_docs: true });
    sourceLookups = jp.query(sourceLookups, '$..lookupValue')
    let gearLookups = await masterDev.view('TripsApi', 'all_em_lookups', { key: 'gear-type', include_docs: true });
    gearLookups = jp.query(gearLookups, '$..lookupValue');

    const gearGroup1 = ["10", "19", "20"];
    const gearGroup2 = ["1", "2", "3", "4", "5"];

    const tripLevelChecks = {
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
                    presence: true
                }
            }
        },
        fisherySector: function (value, attributes) {
            if (attributes.source === sourceType.thirdParty) {
                return {
                    presence: true
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

    const tripResults = validate(catchVal, tripLevelChecks);
    if (tripResults) {
        validationResults += 'trip level errors: ' + JSON.stringify(tripResults)
    }

    let hauls = get(catchVal, 'hauls', []);
    for (let i = 0; i < hauls.length; i++) {
        const haulLevelChecks = {
            haulNum: {
                presence: true
            },
            gearTypeCode: {
                presence: true,
                inclusion: {
                    within: gearLookups,
                    message: 'of ' + hauls[i].gearTypeCode + ' is invalid, accepted values are ' + gearLookups
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
        const haulResults = validate(hauls[i], haulLevelChecks);
        if (haulResults) {
            validationResults += '\nHaul level errors: ' + hauls[i].haulNum + ' ' + JSON.stringify(haulResults);
        }

        let catches = get(hauls[i], 'catch', []);
        for (let j = 0; j < catches.length; j++) {
            let currCatchVal = catchVal.hauls[i].catch[j];
            const catchLevelChecks = {
                disposition: {
                    presence: true,
                    inclusion: {
                        within: [Disposition.DISCARDED, Disposition.RETAINED],
                        message: 'Invalid disposition must be either Discarded or Retained'
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

            const catchResults = validate(currCatchVal, catchLevelChecks);
            if (catchResults) {
                validationResults += '\nCatch level errors: ' + hauls[i].haulNum + ' catch: ' + catches[j].catchId + ' ' + JSON.stringify(catchResults);
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
