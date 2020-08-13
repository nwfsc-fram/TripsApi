const dbConfig = require('./dbConfig.json').dbConfig;
const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev');

import { getFishTicket } from './oracle_routines';

export async function catchEvaluator(tripNum: string) {
    //  wait for a while to be sure data is fully submitted to couch
    setTimeout( async () => {
        // get trip
        const trip = await masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": parseInt(tripNum, 10), "include_docs": true}).then((body) => {
            if ( body.rows.length > 0 ) {
                return body.rows.map((row) => row.doc)[0];
            } else {
                console.log('Doc with specified tripNum not found');
            }
        })
        console.log(trip);

        // get related catch docs
        const tripCatch = await masterDev.view('TripsApi', 'all_api_catch', {"reduce": false, "key": parseInt(tripNum, 10), "include_docs": true}).then((body) => {
            if ( body.rows.length > 0) {
                const docs = body.rows.map((row) => row.doc);
                return docs
            } else {
                console.log('not found');
            }
        })
        console.log(tripCatch);

        // get fishtickets
        const fishTickets = await getFishTicket('50026972');
        console.log(fishTickets);

        // evaluate catch docs
        // is source logbook, thirdParty, or nwfsc
            // logbook

            // thirdParty or nwfsc
        console.log('catch evaluated!!!');
        }, 3000
    )

}