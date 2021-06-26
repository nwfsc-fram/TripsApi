import * as moment from 'moment';
import { WcgopTripError, StatusType, Severity, WcgopError, WcgopTrip, WcgopCatch, WcgopOperation } from '@boatnet/bn-models';
import { masterDev } from './couchDB';
import { sumBy } from 'lodash';
import { nullLiteral, catchClause } from '@babel/types';

var validate = require("validate.js");

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

export async function runTripErrorChecks (req, res) {
    const trip = await masterDev.get(req.query.tripId);
    let tripErrorDoc : WcgopTripError = {};
    const errors: WcgopError[] = [{}];
    let error : WcgopError = {};
    let catchDoc : WcgopCatch = {};
    let operation : WcgopOperation = {};
    let isFitNull : boolean = true;
    let observerTotalCatch : number = 0;
    let maxOperationCreatedDate : Date;
    
    try {
        tripErrorDoc = await masterDev.view('obs_web', 'wcgop-trip-errors', {include_docs: true, reduce: false, key: trip.legacy.tripId});
        tripErrorDoc = tripErrorDoc.rows[0].doc;
    }
    catch (err)
    {
        tripErrorDoc = {
            tripNumber : trip.legacy.tripId,
            type : 'wcgop-trip-error',
            errors
        }
    }
    //const previousTripErrors = await masterDev.view('obs_web', 'wcgop-trip-errors', {include_docs: true, reduce: false, key: trip.legacy.tripId});
    // for (var previousTripError of previousTripErrors.rows) {
    //     masterDev.destroy(previousTripError.doc._id, previousTripError.doc._rev);
    // }

    // get all the operation docs for the trip.
    let operations = await masterDev.view('wcgop',  'all-operations',
        {include_docs: true, keys: trip.operationIDs} as any);
    
    operations = operations.rows.map( (row: any) => row.doc );

    for (const operation of operations)
    {
      //  const operation = await masterDev.get(operationID);
        runPartialLostGearCheck(tripErrorDoc, trip, operation); 
        runRetrievalLocationDateCheck(tripErrorDoc, trip, operation); 
        runTotalHooksLessThan100Check(tripErrorDoc, trip, operation); 
        runOperationStartEndLocationsCheck(tripErrorDoc, trip, operation); 
        runMSOTCOver300KCheck(tripErrorDoc, trip, operation);
        runFishActivityWithNoDispositionCheck(tripErrorDoc, trip, operation);
        runRetrievalDepthGreater500FMCheck(tripErrorDoc, trip, operation);
        runWrongOTCPartialGearCheck(tripErrorDoc, trip, operation);
        runShrimpPotOTCGreater1000Check(tripErrorDoc, trip, operation);
        runLineOTCGreater1000Check(tripErrorDoc, trip, operation);
     
        for (let catchDoc of operation.catches)
        {
            runOpenAccess500CatchWeightCheck(tripErrorDoc, trip, operation, catchDoc);
            runCatchMethod5Check(tripErrorDoc, trip, operation, catchDoc);
            runFixedGearSampleWeightBlankCheck(tripErrorDoc, trip, operation, catchDoc);
            runFixedGearSampleWeightGreater8000Check(tripErrorDoc, trip, operation, catchDoc);
        }

    }

    runCAFishTicketCheck(tripErrorDoc, trip); 
    runTripReturnDateCheck(tripErrorDoc, trip);
    runObsLogbookMissingCheck(tripErrorDoc, trip);
    runLongTripCheck(tripErrorDoc, trip);
    runBlankFitValueCheck(tripErrorDoc, trip, operations);
    runInactiveVesselCheck(tripErrorDoc, trip);
    runTripCreatedAfterReturnCheck(tripErrorDoc, trip, operations);
    runFishTicketDateCheck(tripErrorDoc, trip); 
    runBeaufortSeaStateLevelCheck(tripErrorDoc, trip, operations);
    runIntendedGearTypeMissingCheck(tripErrorDoc, trip); 
    runPermitNumberNotSFCFACheck(tripErrorDoc, trip);
    runPermitNumberNot5DigitsCheck(tripErrorDoc, trip);
    runIntendedGearTypeMissingCheck(tripErrorDoc, trip);
    runFisheryMissingCheck(tripErrorDoc, trip);

    const confirmation = await masterDev.bulk({docs: [tripErrorDoc]});
    res.status(200).send(confirmation);
}

//trip check code 98300 
function runPartialLostGearCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {
    let error = {severity: Severity.error,
        description: 'Wrong gear performance for partial lost gear',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        operationId: operation._id,
        operationNum: operation.operationNum,
        errorItem: 'Gear Performance',
        errorValue: operation.gearPerformance.description,
        notes: '',
        legacy:{
            checkCode : 98300 
        }
    };

    const gearPerformanceChecks = {
        "gearPerformance.description": {
            exclusion: {
                within: ["Problem - trawl net or codend lost"],
                message: error
              }
        }
    };

    if (//operation.gearPerformance.description !=='Problem - trawl net or codend lost' && 
        operation.totalHooksLost>0)
    { 
        //tripErrorDoc.errors.push(error); 
        tripErrorDoc.errors.push(validate(operation, gearPerformanceChecks, {format: "flat"}));
    }
}

//trip check code 110020 
function runTripReturnDateCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip) {
    let error : WcgopError = {severity: Severity.warning,
        description: 'Trip created after return date, please keep paper records',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        errorItem: 'Last Haul Entered',
        errorValue: trip.createdDate,
        notes: '',
        legacy:{
            checkCode : 110020 
        }
    };

    const tripReturnDateChecks = {
        returnDate: {
            datetime: {
                dateOnly: true,
                latest: trip.createdDate,
                message: error
            }
        }
    };
    if ( trip.dataSource === undefined || 
        (trip.dataSource !== undefined && !trip.dataSource.includes ("optecs") ) 
    )
    { 
        tripErrorDoc.errors.push(validate(trip, tripReturnDateChecks, {format: "flat"}));
    }
}

//trip check code 1300 
function runCAFishTicketCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip) {
    for (const fishTicket of trip.fishTickets)
    {
        let error = {severity: Severity.error,
            description: 'California fish ticket is not 7 characters long',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            errorItem: 'Fish Ticket',
            errorValue: fishTicket.fishTicketNumber,
            notes: '',
            legacy:{
                checkCode : 1300 
            }
        };

        const ticketNumberValidation = ['B', 'C', 'D', 'E', 'F', 'H', 'J', 'K', 'L', 'N', 'O', 'P', 'R', 'V', 'W', 'X', 'Z'];        
        const fishTicketChecks = {
            fishTicketNumber: {
                presence: true,
                format: {
                  pattern: /^[BCDEFHJKLNOPRVWXZ][a-zA-Z0-9]{5}[a-df-zA-DF-Z0-9]{1}$/,
                  message: error
                  }
            }
        };

        if (fishTicket.stateAgency ==='C' /*&& 
                (fishTicket.fishTicketNumber.length!==7 || 
                    !ticketNumberValidation.includes(fishTicket.fishTicketNumber.substring(0,1).toUpperCase()) &&
                    fishTicket.fishTicketNumber.substring(6,1).toUpperCase()!='E'
                )*/
        )
        { 
            tripErrorDoc.errors.push(validate(fishTicket, fishTicketChecks, {format: "flat"}));
        }
    }
}


//trip check code 32200 
function runObsLogbookMissingCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip) {
    let error : WcgopError = {severity: Severity.error,
        description: 'Observer logbook number is missing',
        dateCreated: moment().format(), 
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        errorItem: 'Observer logbook #',
        errorValue: trip.logbook,
        notes: '',
        legacy:{
            checkCode : 32200 
        }
    };

    const obsLogbookMissingChecks = {
        logbookNum: {
            presence: true
        }
    };

    tripErrorDoc.errors.push(validate(trip, obsLogbookMissingChecks, {format: "flat"}));
}


//trip check code 500 
function runLongTripCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip) {
    let error : WcgopError = {severity: Severity.warning,
        description: 'Trip is longer than 10 days',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        errorItem: 'Trip Length',
        errorValue: moment(trip.departureDate).diff(trip.returnDate).toString(),
        notes: '',
        legacy:{
            checkCode : 500 
        }
    };

    if ( trip.fishery.description!=="Mothership Catcher-Vessel" && moment(trip.departureDate).diff(trip.returnDate)>10 ) 
    { 
        tripErrorDoc.errors.push(error);
    }
}


//trip check code 110016 
function runBlankFitValueCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operations: any) {
    let error : WcgopError = {severity: Severity.warning,
        description: 'Fit value not entered for any haul',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        errorItem: 'Missing Fit Value',
        errorValue: null,
        notes: '',
        legacy:{
            checkCode : 110016 
        }
    };

    const observerTotalCatch = sumBy(operations, 'observerTotalCatch');
    const operationTotalFit = sumBy(operations, 'fit');

    const blankFitChecks = {
        "fishery.description": {
            exclusion: {
                within: ["Mothership Catcher-Vessel", "OR Blue/Black Rockfish Nearshore", "OR Blue/Black Rockfish", "Shoreside Hake", "CA Fosmark EFP" ], //legacy: 21,11,12,20,23
                message: error
              }
        }
    };

    if ( operationTotalFit === null && observerTotalCatch > 0 )
    { 
        tripErrorDoc.errors.push(validate(trip, blankFitChecks, {format: "flat"}));
    }

}


//trip check code 110014 
function runInactiveVesselCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip) {
    let error : WcgopError = {severity: Severity.error,
        description: 'Vessel inactive, please review selected vessel',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        errorItem: trip.vessel.vesselName + ' - ' + trip.vessel.coastGuardNumber ? trip.vessel.coastGuardNumber : trip.vessel.stateRegulationNumber,
        errorValue: trip.vessel.vesselStatus.description,
        notes: '',
        legacy:{
            checkCode : 110014 
        }
    };

    const inactiveVesselChecks = {
        "vessel.vesselStatus.description": {
            inclusion: {
                within: ["Inactive - Vessel ID changed", "Sunk", "Retired" ], 
                message: error
              }
        }
    };

    tripErrorDoc.errors.push(validate(trip, inactiveVesselChecks, {format: "flat"}));
}

//trip check code 110020 
function runTripCreatedAfterReturnCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operations: any) {

    // store operation created dates as moment objects.
    const createdDates = operations.map( (row: any) => moment(row.createdDate) );

    // get max moment ()
    const maxOperationCreatedDate = moment.max(createdDates).format();

    let error : WcgopError = {severity: Severity.error,
        description: 'Trip created after return date, please keep paper records',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        errorItem: 'Last Haul Entered',
        errorValue: maxOperationCreatedDate.toString(),
        notes: '',
        legacy:{
            checkCode : 110020 
        }
    };

    if ( !trip.dataSource.toString().includes("optecs") && ( maxOperationCreatedDate === null || moment(trip.returnDate).isBefore(maxOperationCreatedDate) ) )
        tripErrorDoc.errors.push(error);
}

//trip check code 110015 
function runFishTicketDateCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip) {

    for (const fishTicket of trip.fishTickets)
    {

        if ( moment(trip.returnDate).diff(fishTicket.date)>3 )
        {
             let error = {severity: Severity.warning,
                description: 'Fish ticket date is not within 3 days after return date',
                dateCreated: moment().format(),
                observer: trip.observer.firstName + ' ' + trip.observer.lastName,
                status: StatusType.valid,
                errorItem: 'Fish Ticket Date',
                errorValue: fishTicket.date,
                notes: '',
                legacy:{
                    checkCode : 110015 
                }
            };

            tripErrorDoc.errors.push( error );;
        }
    }

}

//trip check code 110013 
function runBeaufortSeaStateLevelCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operations: any) {

    const operationWithLevel = operations.find( (operation) => operation.beaufortValue === 8 || operation.beaufortValue === 9)

    if ( operationWithLevel )
    { 

        let error : WcgopError = {severity: Severity.warning,
            description: 'Beaufort sea state recorded as level 8 or 9.  Please review and confirm',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            operationId: operationWithLevel._id,
            operationNum: operationWithLevel.operationNum,
            errorItem: 'Beaufort Value',
            errorValue: operationWithLevel.beaufortValue,
            notes: '',
            legacy:{
                checkCode : 110013 
            }
        };

        tripErrorDoc.errors.push( error );
    }

}

//trip check code 103900 
function runRetrievalLocationDateCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {

    for (const operationLocation of operation.locations)
    {
        if ( operationLocation.position ===0 && 
            (operation.gearType.description ==="Fish pot" || 
                operation.gearType.description ==="Hook & Line" || 
                operation.gearType.description ==="Longline (snap)") && //gear type in 10,19,20
            (moment(operationLocation.locationDate).isBefore(trip.departureDate) ||
                moment(operationLocation.locationDate).isAfter(trip.returnDate))
        )
        { 
            let error = {severity: Severity.error,
                description: 'Retrieval location date is outside the trip departure and return dates',
                dateCreated: moment().format(),
                observer: trip.observer.firstName + ' ' + trip.observer.lastName,
                status: StatusType.valid,
                operationId: operation._id,
                operationNum: operation.operationNum,
                errorItem: 'Location Date',
                errorValue: operationLocation.locationDate,
                notes: '',
                legacy:{
                    checkCode : 103900 
                }
        };

            tripErrorDoc.errors.push( error );
    
        }
    }
}


//trip check code 103800 
function runTotalHooksLessThan100Check(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {

    if ( (operation.gearType.description ==="Hook & Line" || 
            operation.gearType.description ==="Longline (snap)") && //gear type in 19,20
        (operation.gearPerformance.description !=="Problem - trawl net or codend lost") && //gear performance != 5 
            operation.totalHooks < 100
    )
    { 
        let error = {severity: Severity.warning,
            description: 'Total Hook Count < 100',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            operationId: operation._id,
            operationNum: operation.operationNum,
            errorItem: 'Gear Type',
            errorValue: operation.totalHooks.toString(),
            notes: '',
            legacy:{
                checkCode : 103800 
            }
        };

        tripErrorDoc.errors.push( error );

    }
}


//trip check code 104601 
function runFishProcessedCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip) {

    if ( trip.isFishProcessed && moment(trip.returnDate).isAfter( moment('2016-01-01') ) )
    { 
        let error = {severity: Severity.warning,
            description: '"Fish processed during trip?" marked Yes. Ensure that species and type of processing is included in trip notes.',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            errorItem: 'Fish Processed',
            errorValue: trip.isFishProcessed.toString(),
            notes: '',
            legacy:{
                checkCode : 104601 
            }
        };

        tripErrorDoc.errors.push( error );

    }
}


//trip check code 110012 
function runOperationStartEndLocationsCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {

    //find the location with the max position in all locations
    var maxPositionedLocation = operation.locations.reduce(function(prev, current) {
        if (+current.position > +prev.position) {
            return current;
        } else {
            return prev;
        }
    });

    //find the location with the min position in all locations
    var minPositionedLocation = operation.locations.reduce(function(prev, current) {
        if (+current.position < +prev.position) {
            return current;
        } else {
            return prev;
        }
    });

    if ( (trip.program.description === "TIQ Catch Shares" || //program_id in (14, 17)
            trip.program.description === "Electronic Monitoring EFP") && 
            calculateFishingArea(maxPositionedLocation.coordinates[0])!==calculateFishingArea(minPositionedLocation.coordinates[0]) )
    { 
        let error = {severity: Severity.warning,
            description: 'Haul starts and ends in different management areas',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            operationId: operation._id,
            operationNum: operation.operationNum,
            errorItem: 'Fishing Areas',
            errorValue: calculateFishingArea(minPositionedLocation.coordinates[0])+'-->'+calculateFishingArea(maxPositionedLocation.coordinates[0]),
            notes: '',
            legacy:{
                checkCode : 110012 
            }
        };

        tripErrorDoc.errors.push( error );

    }
    
}

//helper function to get the management area
//replicated from function OBSPROD.WCGOP_IFQ_RECEIPTS_XML.fnd_fishing_area
function calculateFishingArea(latitude: number) {
    let returnArea = null;
    if ( latitude>40.166667 )
        returnArea = 100;
    else if( latitude > 36.0 && latitude < 40.166667)
        returnArea = 200;
    else if( latitude > 34.45 && latitude < 36.0)
        returnArea = 300;
    else if( latitude < 34.45 )
        returnArea = 400;    

    return returnArea;
}

//trip check code 106700 
function runIntendedGearTypeMissingCheck(tripErrorDoc: WcgopTripError, trip: any) {
    let error : WcgopError = {severity: Severity.error,
        description: 'Intended Gear Type is missing',
        dateCreated: moment().format(), 
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        errorItem: 'Intended Gear Type',
        errorValue: trip.intendedGearType,
        notes: '',
        legacy:{
            checkCode : 106700 
        }
    };

    const intendedGearTypeMissingChecks = {
        intendedGearType: {
            presence: false
        },
        isNoFishingActivity: {
            presence: true
        }
    };

    tripErrorDoc.errors.push(validate(trip, intendedGearTypeMissingChecks, {format: "flat"}));
}

//trip check code 104400 
function runPermitNumberNot5DigitsCheck(tripErrorDoc: WcgopTripError, trip: any) {
    
    for (const certificate of trip.certificates)
    {    

        if( (certificate.certificateNumber === null || certificate.certificateNumber === "" 
                || (certificate.certificateNumber !==null && certificate.certificateNumber.length!=5)) &&
                (trip.fishery.description!=="CA Pink Shrimp" || trip.fishery.description!=="OR Pink Shrimp" || //t.fishery IN (9, 13, 18)
                trip.fishery.description!=="WA Pink Shrimp") &&
                moment(trip.returnDate).isAfter( moment('2015-01-01') ) )
        {
            let error : WcgopError = {severity: Severity.error,
                description: 'Permit Number is missing or is not 5 digits',
                dateCreated: moment().format(), 
                observer: trip.observer.firstName + ' ' + trip.observer.lastName,
                status: StatusType.valid,
                errorItem: 'Certificate #',
                errorValue: certificate.certificateNumber,
                notes: '',
                legacy:{
                    checkCode : 104400 
                }
            };

            tripErrorDoc.errors.push( error );
        }
    }

}

//trip check code 104101 
function runPermitNumberNotSFCFACheck(tripErrorDoc: WcgopTripError, trip: any) {
    
    for (const certificate of trip.certificates)
    {    

        if( (certificate.certificateNumber === null || certificate.certificateNumber === "" 
                || (certificate.certificateNumber !==null && !certificate.certificateNumber.includes("SFCFA"))) &&
                trip.fishery.description!=="CA Emley-Platt SFCFA EFP" )
        {
            let error : WcgopError = {severity: Severity.error,
                description: 'Permit Number is missing or does not contain SFCFA',
                dateCreated: moment().format(), 
                observer: trip.observer.firstName + ' ' + trip.observer.lastName,
                status: StatusType.valid,
                errorItem: 'Certificate #',
                errorValue: certificate.certificateNumber,
                notes: '',
                legacy:{
                    checkCode : 104101 
                }
            };

            tripErrorDoc.errors.push( error );
        }
    }

}

//trip check code 104100 
function runPermitNumberNotContainBTCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip) {
    
    for (const certificate of trip.certificates)
    {    
        if( (certificate.certificateNumber === null || certificate.certificateNumber === "" 
                || (certificate.certificateNumber !==null && !certificate.certificateNumber.includes("BT")) &&
                trip.fishery.description!=="CA Halibut" &&
                moment(trip.returnDate).isAfter( moment('2015-01-01') ) ))
        {
            let error : WcgopError = {severity: Severity.error,
                description: 'Permit Number is missing or does not start with "BT"',
                dateCreated: moment().format(), 
                observer: trip.observer.firstName + ' ' + trip.observer.lastName,
                status: StatusType.valid,
                errorItem: 'Certificate #',
                errorValue: certificate.certificateNumber,
                notes: '',
                legacy:{
                    checkCode : 104100 
                }
            };

            tripErrorDoc.errors.push( error );
        }
    }

}

//trip check code 103301 
function runFisheryMissingCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip) {
    
    let error : WcgopError = {severity: Severity.error,
        description: 'Fishery is missing',
        dateCreated: moment().format(), 
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        errorItem: 'Fishery is missing',
        notes: '',
        legacy:{
            checkCode : 103301 
        }
    };

    const fisheryMissingChecks = {
        "trip.fishery": {
            presence: true
        }
    };

    tripErrorDoc.errors.push(validate(trip, fisheryMissingChecks, {format: "flat"}));
}

//trip check code 32100 
function runMSOTCOver300KCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {

    if ( (trip.fishery.description === "Shoreside Hake" || 
            trip.fishery.description === "Mothership Catcher-Vessel") && 
            operation.observerTotalCatch.measurement.value>300000)
    { 
        let error = {severity: Severity.warning,
            description: 'Mothership Catcher Vessel or Shoreside Hake OTC >300,000 lbs',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            operationId: operation._id,
            operationNum: operation.operationNum,
            errorItem: 'OTC',
            errorValue: operation.observerTotalCatch.measurement.value.toString(),
            notes: '',
            legacy:{
                checkCode : 32100 
            }
        };

        tripErrorDoc.errors.push( error );
    }
    
}


//trip check code 91800 
function runOpenAccess500CatchWeightCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation, catchDoc: WcgopCatch ) {

    let error = {severity: Severity.warning,
        description: 'Open access gear (7, 8, 9, 14, 15, 16) and catch weight is greater than 500 lbs',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        operationId: operation._id,
        operationNum: operation.operationNum,
        catchId: catchDoc.legacy.catchId,
        catchNum: catchDoc.catchNum,
        errorItem: 'Weight',
        errorValue: null,
        notes: '',
        legacy:{
            checkCode : 91800 
        }
    };
    if ( ((operation.gearType.description === "All net gear except trawl" || 
            operation.gearType.description === "All other miscellaneous gear" )) && //gear_type IN (14,16)
            catchDoc.weight.value > 500)
    { 
        error.errorValue = catchDoc.weight.value.toString();
        tripErrorDoc.errors.push( error );
    }
    else if( ((operation.gearType.description === "Vertical hook and line gear" || 
                operation.gearType.description === "Pole (commercial)" ||
                operation.gearType.description === "Other hook and line gear" ||
                operation.gearType.description === "All troll gear")) &&  //gear_type   in (7,8,9,15)
                catchDoc.sampleWeight.value > 500)
    { 
        error.errorValue = catchDoc.sampleWeight.value.toString();
        tripErrorDoc.errors.push( error );
    }
    
}


//trip check code 102200 
function runFishActivityWithNoDispositionCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {

    const catches = operation.catches;
    const catchWithRetainedDisposition = catches.find( (element) => element.disposition.description === "Retained")

    if ( (trip.fishery.description === "Catch Shares" || 
            trip.fishery.description === "Shoreside Hake"|| 
            trip.fishery.description === "Mothership Catcher-Vessel") && //fishery in ('19', '20', '21') 
            operation.observerTotalCatch.measurement.value>0 &&
            !catchWithRetainedDisposition) //meaning there are no Catches with Retained disposition 
    { 
        let error = {severity: Severity.warning,
            description: 'Haul missing retained catch categories',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            operationId: operation._id,
            operationNum: operation.operationNum,
            errorItem: 'Fish activities with no disposition = R catches',
            errorValue: null,
            notes: '',
            legacy:{
                checkCode : 102200 
            }
        };

        tripErrorDoc.errors.push( error );
    }
    
}

//trip check code 100302 
function runRetrievalDepthGreater500FMCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {

    for (const operationLocation of operation.locations)
    {
        if ( operationLocation.depth.value >500 && operationLocation.depth.units === "FM" && operationLocation.position === 0 &&
            (operation.gearType.description ==="Groundfish trawl, footrope < 8 inches (small footrope)" || 
                operation.gearType.description ==="Groundfish trawl, footrope > 8 inches (large footrope)" || 
                operation.gearType.description ==="Danish/Scottish Seine (trawl)" || 
                operation.gearType.description ==="Other trawl gear" || 
                operation.gearType.description ==="Prawn trawl" || 
                operation.gearType.description ==="Shrimp trawl, single rigged" || 
                operation.gearType.description ==="Shrimp trawl, double rigged" || 
                operation.gearType.description ==="All net gear except trawl" || 
                operation.gearType.description ==="All other miscellaneous gear" || 
                operation.gearType.description ==="Oregon set-back flatfish net")  //gear_type IN (1, 2, 4, 5, 11, 12, 13, 14 ,16, 17)
        )
        {
            let error = {severity: Severity.warning,
                description: 'Retrieval depth is greater than 500 fathoms',
                dateCreated: moment().format(),
                observer: trip.observer.firstName + ' ' + trip.observer.lastName,
                status: StatusType.valid,
                operationId: operation._id,
                operationNum: operation.operationNum,
                fishingLocation: operationLocation,
                errorItem: 'Depth',
                errorValue: operationLocation.depth.value.toString(),
                notes: '',
                legacy:{
                    checkCode : 100302 
                }
            };

            tripErrorDoc.errors.push( error );
    
        }
    }
}

//trip check code 98200 
function runWrongOTCPartialGearCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {

    if (operation.observerTotalCatch.weightMethod.description != 'Extrapolation' && 
            operation.totalHooks!=operation.totalHooksLost
    )
    {
        let error = {severity: Severity.error,
            description: 'Wrong OTC weight method for partial lost gear',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            operationId: operation._id,
            operationNum: operation.operationNum,
            errorItem: 'OTC Weight Method',
            errorValue: operation.observerTotalCatch.weightMethod.description,
            notes: '',
            legacy:{
                checkCode : 98200 
            }
        };

        tripErrorDoc.errors.push( error );
    }

}

//trip check code 70700 
function runShrimpPotOTCGreater1000Check(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {

    if ( operation.gearType.description ==="Prawn trap" && //gear_type = 18
            operation.observerTotalCatch.measurement.value>1000)
    { 
        let error = {severity: Severity.warning,
            description: 'Shrimp pot OTC is greater than 1000 lbs',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            operationId: operation._id,
            operationNum: operation.operationNum,
            errorItem: 'OTC',
            errorValue: operation.observerTotalCatch.measurement.value.toString(),
            notes: '',
            legacy:{
                checkCode : 70700 
            }
        };

        tripErrorDoc.errors.push( error );
    }
    
}

//trip check code 80100 
function runLineOTCGreater1000Check(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation) {

    if ( operation.gearType.description ==="Vertical hook and line gear" && //gear_type = 7
            operation.observerTotalCatch.measurement.value>1000)
    { 
        let error = {severity: Severity.warning,
            description: 'Line gear OTC is greater than 1000 lbs',
            dateCreated: moment().format(),
            observer: trip.observer.firstName + ' ' + trip.observer.lastName,
            status: StatusType.valid,
            operationId: operation._id,
            operationNum: operation.operationNum,
            errorItem: 'OTC',
            errorValue: operation.observerTotalCatch.measurement.value.toString(),
            notes: '',
            legacy:{
                checkCode : 80100 
            }
        };

        tripErrorDoc.errors.push( error );
    }
    
}


//trip check code 7150 
function runCatchMethod5Check(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation, catchDoc: WcgopCatch ) {

    let error = {severity: Severity.warning,
        description: 'Catch Weight Method 5 is not common',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        operationId: operation._id,
        operationNum: operation.operationNum,
        catchId: catchDoc.legacy.catchId,
        catchNum: catchDoc.catchNum,
        errorItem: 'Catch Weight Method',
        errorValue: null,
        notes: '',
        legacy:{
            checkCode : 7150 
        }
    };
    if ( catchDoc.weightMethod.description === "OTC - retained" && // catch_weight_method = 5
            moment(trip.returnDate).isAfter( moment('2011-01-01') ))
    { 
        error.errorValue = catchDoc.weightMethod.description;
        tripErrorDoc.errors.push( error );
    }
    
}

//trip check code 31600 
function runFixedGearSampleWeightBlankCheck(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation, catchDoc: WcgopCatch ) {

    let error = {severity: Severity.error,
        description: 'Fixed gear sample weight is negative, zero or blank',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        operationId: operation._id,
        operationNum: operation.operationNum,
        catchId: catchDoc.legacy.catchId,
        catchNum: catchDoc.catchNum,
        errorItem: 'Sample Weight',
        errorValue: null,
        notes: '',
        legacy:{
            checkCode : 31600 
        }
    };
    if ( (operation.gearType.description === "Longline (snap)" || 
            operation.gearType.description === "Pole (commercial)" || 
            operation.gearType.description === "Other hook and line gear" || 
            operation.gearType.description === "Fish pot" || 
            operation.gearType.description === "All troll gear" || 
            operation.gearType.description === "Longline" || 
            operation.gearType.description === "Vertical hook and line gear" || 
            operation.gearType.description === "Hook & Line" ) && //gear_type IN (20,8,9,10,15,6,7,19)
            catchDoc.sampleWeight.value === undefined ||  catchDoc.sampleWeight.value === null 
            ||    catchDoc.sampleWeight.value <= 0)
    { 
        error.errorValue = catchDoc.sampleWeight.value;
        tripErrorDoc.errors.push( error );
    }
    
}

//trip check code 91300 
function runFixedGearSampleWeightGreater8000Check(tripErrorDoc: WcgopTripError, trip: WcgopTrip, operation: WcgopOperation, catchDoc: WcgopCatch ) {

    let error = {severity: Severity.warning,
        description: 'Fixed gear sample weight is greater than 8000 lbs',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
        operationId: operation._id,
        operationNum: operation.operationNum,
        catchId: catchDoc.legacy.catchId,
        catchNum: catchDoc.catchNum,
        errorItem: 'Weight',
        errorValue: null,
        notes: '',
        legacy:{
            checkCode : 91300 
        }
    };
    if ( (  operation.gearType.description === "Longline" || 
            operation.gearType.description === "Fish pot" ) && //gear_type IN (6,10)
            catchDoc.sampleWeight.value > 8000)
    { 
        error.errorValue = catchDoc.sampleWeight.value;
        tripErrorDoc.errors.push( error );
    }
    
}