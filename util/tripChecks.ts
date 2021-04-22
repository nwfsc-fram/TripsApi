import * as moment from 'moment';
import { WcgopTripError, StatusType, Severity, WcgopError } from '@boatnet/bn-models';
import { masterDev } from './couchDB';

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
    let isFitNull : boolean = true;
    let observerTotalCatch : number = 0;
    
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

    for (const operationID of trip.operationIDs)
    {
        const operation = await masterDev.get(operationID);
        runPartialLostGearCheck(tripErrorDoc, trip, operation); 
        if ( operation.Fit >=0 )
            isFitNull = false;
        observerTotalCatch += observerTotalCatch + operation.observerTotalCatch;
    }

    runCAFishTicketCheck(tripErrorDoc, trip); 
    runTripReturnDateCheck(tripErrorDoc, trip);
    runObsLogbookMissingCheck(tripErrorDoc, trip);
    runLongTripCheck(tripErrorDoc, trip);
    runBlankFitValueCheck(tripErrorDoc, trip, isFitNull, observerTotalCatch);
    runInactiveVesselCheck(tripErrorDoc, trip);


    const confirmation = await masterDev.bulk({docs: [tripErrorDoc]});
    res.status(200).send(confirmation);
}

//trip check code 98300 
function runPartialLostGearCheck(tripErrorDoc: WcgopTripError, trip:any, operation: any) {
    let error = {severity: Severity.error,
        description: 'Wrong gear performance for partial lost gear',
        dateCreated: moment().format(),
        observer: trip.observer.firstName + ' ' + trip.observer.lastName,
        status: StatusType.valid,
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
function runTripReturnDateCheck(tripErrorDoc: WcgopTripError, trip: any) {
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
function runCAFishTicketCheck(tripErrorDoc: WcgopTripError, trip: any) {
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
function runObsLogbookMissingCheck(tripErrorDoc: WcgopTripError, trip: any) {
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
        logbook: {
            presence: true
        }
    };

    tripErrorDoc.errors.push(validate(trip, obsLogbookMissingChecks, {format: "flat"}));
}


//trip check code 500 
function runLongTripCheck(tripErrorDoc: WcgopTripError, trip: any) {
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
function runBlankFitValueCheck(tripErrorDoc: WcgopTripError, trip: any, isFitNull: boolean, observerTotalCatch: number) {
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

    const blankFitChecks = {
        "fishery.description": {
            exclusion: {
                within: ["Mothership Catcher-Vessel", "OR Blue/Black Rockfish Nearshore", "OR Blue/Black Rockfish", "Shoreside Hake", "CA Fosmark EFP" ], //legacy: 21,11,12,20,23
                message: error
              }
        }
    };

    if ( isFitNull && observerTotalCatch > 0 )
    { 
        tripErrorDoc.errors.push(validate(trip, blankFitChecks, {format: "flat"}));
    }

}


//trip check code 110014 
function runInactiveVesselCheck(tripErrorDoc: WcgopTripError, trip: any) {
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