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
        error = {severity: Severity.error,
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

    for (const fishTicket of trip.fishTickets)
    {
        error = {severity: Severity.error,
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

        runTripReturnDateCheck(tripErrorDoc, trip); //run trip check code 110020

    }
    const confirmation = await masterDev.bulk({docs: [tripErrorDoc]});
    res.status(200).send(confirmation);
}

//run trip check code 110020
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