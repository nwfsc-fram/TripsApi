import * as moment from 'moment';
import { WcgopTripError, StatusType, Severity, WcgopError } from '@boatnet/bn-models';
import { masterDev } from './couchDB';
import { flattenDeep } from 'lodash';
const jp = require('jsonpath');




const checkSpeciesCode = function(operation: any) {
    const knownCodes = [123, 223, 333];
    return knownCodes.includes(operation.speciesCode) ? 'known code' : 'unknown code'
}

export async function runTripErrorChecks (req, res) {
    const operation = {
        hauls: [
            {
                haulNum: 123,
                catch: [
                    {speciesCode: 123, comments: 'fish'},
                    {speciesCode: 324},
                    {speciesCode: 555}
                ]
            },
            {
                haulNum: 124,
                catch: [
                    {speciesCode: 223, comments: 'fish'},
                    {speciesCode: 324},
                    {speciesCode: 555}
                ]
            },
            {
                haulNum: 125,
                catch: [
                    {speciesCode: 323, comments: 'fish'},
                    {speciesCode: 324, subItem: {
                        subHaulNum: 3335,
                        catch: [
                            {speciesCode: 333},
                            {speciesCode: 999}
                        ]
                    }},
                    {speciesCode: 555}
                ]
            },
        ]
    }

    const fishCatch: any = flattenDeep(jp.query(operation, '$..catch'))
    fishCatch.forEach( (catchItem) => console.log(catchItem.speciesCode + ' : ' + checkSpeciesCode(catchItem)))

    const trip = await masterDev.get(req.query.tripId);
    let tripErrorDoc : WcgopTripError = {};
    const errors: WcgopError[] = [{}];
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
        if (operation.gearPerformance.description !=='Problem - trawl net or codend lost' && operation.totalHooksLost>0)
        {
            let error : WcgopError = {
                severity: Severity.error,
                description: 'Wrong gear performance for partial lost gear',
                dateCreated: moment().format(),
                observer: trip.firstName + ' ' + trip.lastName,
                status: StatusType.valid,
                errorItem: 'Gear Performance',
                errorValue: operation.gearPerformance.description,
                notes: '',
                legacy:{
                    checkCode : 98300
                }
            };

            tripErrorDoc.errors.push(error);
        }
    }

    for (const fishTicket of trip.fishTickets)
    {
        const ticketNumberValidation = ['B', 'C', 'D', 'E', 'F', 'H', 'J', 'K', 'L', 'N', 'O', 'P', 'R', 'V', 'W', 'X', 'Z'];

        if (fishTicket.stateAgency ==='C' &&
                (fishTicket.fishTicketNumber.length!==7 ||
                    !ticketNumberValidation.includes(fishTicket.fishTicketNumber.substring(0,1).toUpperCase()) &&
                    fishTicket.fishTicketNumber.substring(6,1).toUpperCase()!='E'
            )
        )
        {
            let error : WcgopError = {
                severity: Severity.error,
                description: 'California fish ticket is not 7 characters long',
                dateCreated: moment().format(),
                observer: trip.firstName + ' ' + trip.lastName,
                status: StatusType.valid,
                errorItem: 'Fish Ticket',
                errorValue: fishTicket.fishTicketNumber,
                notes: '',
                legacy:{
                    checkCode : 1300
                }
            };

            tripErrorDoc.errors.push(error);
        }
    }

    const confirmation = await masterDev.bulk({docs: [tripErrorDoc]});
    res.status(200).send(confirmation);
}