const dbConfig = require('./dbConfig.json').dbConfig;
const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev');
const jp = require('jsonpath');
import { cloneDeep, flattenDeep, get, remove, set, uniqBy, uniq } from 'lodash';

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

        // get catch docs
        const tripCatches = await masterDev.view('TripsApi', 'all_api_catch', {"reduce": false, "key": parseInt(tripNum, 10), "include_docs": true}).then((body) => {
            if ( body.rows.length > 0) {
                const docs = body.rows.map((row) => row.doc);
                return docs
            } else {
                console.log('not found');
            }
        })

        let logbook = null;
        let thirdParty = null;  // does this expansion relate to review data in any way, or is it logbook only?
        let nwfscAudit = null;

        for (const tripCatch of tripCatches) {
            if (tripCatch.source === 'logbook') {
                logbook = cloneDeep(tripCatch)
            } else if (tripCatch.source === 'thirdParty') {
                thirdParty = cloneDeep(tripCatch)
            } else if (tripCatch.source === 'nwfscAudit') {
                nwfscAudit = cloneDeep(tripCatch)
            }
        }

        // let catches: any[] = jp.query(logbook, '$..catch');
        // catches = flattenDeep(catches);
        // would it make sense to format like proposed output before feeding to expansions?

        const fishTickets = [];
        for (const row of logbook.fishTickets) {
            fishTickets.push(fishTickets, await getFishTicket(row.fishTicketNumer))
        }

        // Calculation for any fish submitted without a weight.
        // Lost gear
        // Apportioning data for a grouping (example THDS)
        // NonIFQ species

        // evaluate catch docs
        // is source logbook, thirdParty, or nwfsc
            // logbook

            // thirdParty or nwfsc
        console.log('catch evaluated!!!');
        }, 3000
    )

}