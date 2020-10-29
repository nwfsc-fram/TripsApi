import { Catches, Disposition, sourceType } from "@boatnet/bn-models/lib";
import { get, set } from 'lodash';
import { masterDev } from './couchDB';
const moment = require('moment');
var validate = require("validate.js");

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

    validate.validators.custom = function (value, options, key, attributes) {
        console.log('attt')
        console.log(attributes)
    }

    const tripLevelChecks = {
        tripNum: {
            presence: true
        },
        source: {
            presence: true,
            inclusion: {
                within: [sourceType.logbook, sourceType.thirdParty, sourceType.nwfscAudit],
                message: 'Improper source type, please reference this for accepted values: https://www.webapps.nwfsc.noaa.gov/trips/lookups#em-source'
            }
        },
        fate: {
            presence: true,
            inclusion: {
                within: ["1", "2", "3", "4", "5", "6"],
                message: 'Invalid fate code accepted codes are: 1-6'
            }
        },
        fisherySector: {
            presence: true,
            inclusion: {
                within: ["Bottom Trawl", "Fixed Gear", "Midwater Rockfish", "Whiting"],
                message: "Invalid fishery sector code reference this for accepted values: https://www.webapps.nwfsc.noaa.gov/trips/lookups#fishery-sector"
            }
        },
        provider: {
            presence: true
        },
        reviewerName: {
            presence: true
        },
        totalReviewTime: {
            presence: true
        },
        departureDateTime: {
            datetime: {
                latest: catchVal.returnDateTime,
                message: 'must occur before Return Date'
            }
        },
        returnDateTime: {
            datetime: {
                earliest: catchVal.departureDateTime,
                message: 'must occur after Departure Date'
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
                    within: ["1", "2", "3", "4", "5", "10", "19", "20"],
                    message: 'Invalid gear type code, reference this for accepted gear types: https://www.webapps.nwfsc.noaa.gov/trips/lookups#gear-type'
                }
            },
            gearPerSet: function (value, attributes) {
                if (["10", "19", "20"].includes(attributes.gearTypeCode)) {
                    return {
                        presence: true
                    }
                }
            },
            gearLost: function (value, attributes) {
                if (["10", "19", "20"].includes(attributes.gearTypeCode)) {
                    return {
                        presence: true
                    }
                }
            },
            avgHooksPerSeg: function (value, attributes) {
                if (["10", "19", "20"].includes(attributes.gearTypeCode)) {
                    return {
                        presence: true
                    }
                }
            },
            netType: function (value, attributes) {
                if (["1", "2", "4", "5"].includes(attributes.gearTypeCode)) {
                    return {
                        presence: true
                    }
                }
            },
            codendCapacity: function (value, attributes) {
                if (["1", "2", "4", "5"].includes(attributes.gearTypeCode)) {
                    return {
                        presence: true
                    }
                }
            },
            isCodendLost: function (value, attributes) {
                if (["1", "2", "4", "5"].includes(attributes.gearTypeCode)) {
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
            startLongitude: function (value, attributes) {
                if (attributes.source === sourceType.logbook) {
                    return {
                        presence: true
                    }
                }
            },
            startLatitude: function (value, attributes) {
                if (attributes.source === sourceType.logbook) {
                    return {
                        presence: true,
                        numericality: {
                            lessThan: 49
                        }
                    }
                }
            },
            endDepth: function (value, attributes) {
                if (attributes.source === sourceType.logbook) {
                    return {
                        presence: true
                    }
                }
            },
            endLongitude: function (value, attributes) {
                if (attributes.source === sourceType.logbook) {
                    return {
                        presence: true
                    }
                }
            },
            endLatitude: function (value, attributes) {
                if (attributes.source === sourceType.logbook) {
                    return {
                        presence: true,
                        numericality: {
                            lessThan: 49
                        }
                    }
                }
            },
            systemPerformance: {
                presence: true,
                inclusion: {
                    within: [1, 2, 3],
                    message: 'Invalid system performance code, accepted codes are 1-3'
                }
            },
            catchHandlingPerformance: {
                presence: true,
                inclusion: {
                    within: [1, 2],
                    message: 'Invalid catch handling performance value accepted codes are 1 or 2'
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
           // let results = await priorityAndProtectedChecks(catchVal.hauls[i], currCatchVal);
           // set(catchVal, 'hauls[' + i + '].catch[' + j + ']', results.currCatch);
           // errors = errors.concat(results.errors);
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
        key: parseInt(currCatch.speciesCode, 10)
    };
    const source = currCatch.source;
    let lookupInfo = await masterDev.view('em-views', 'wcgopCode-to-pacfinCode-map', options);
    lookupInfo = lookupInfo.rows[0].doc;
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
