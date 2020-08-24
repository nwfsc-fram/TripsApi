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

        let catches: any[] = jp.query(logbook, '$..catch');
        catches = flattenDeep(catches);

        const fishTickets = [];
        for (const row of logbook.fishTickets) {
            fishTickets.push(fishTickets, await getFishTicket(row.fishTicketNumer))
        }

        function unsortedCatch(logbook: any, fishTickets: any) { // is this calc done per haul, or for the whole trip
            let catches: any[] = jp.query(logbook, '$..catch');
            catches = flattenDeep(catches);
            const unsortedCatch = catches.reduce( (acc, val) => {
                if (val.speciesCode === 'UNST') {
                    return acc + val.weight;
                } else {
                    return acc;
                }
            }, 0)

            // get total catch weight from fish tickets
            let totalWeight = fishTickets.reduce((acc: number, val: any) => {
                return acc + val.LANDED_WEIGHT_LBS
            }, 0)

            // get unique species from fish tickets
            const specieses = uniq(fishTickets.map( (row: any) => row.PACFIN_SPECIES_CODE))

            // get sum of landed lbs, percent of total, and calculated net bleed lbs per species
            const speciesWeights = [];
            for (const species of specieses) {
                const speciesWeight = fishTickets.reduce((acc: number, val: any) => {
                    if (val.PACFIN_SPECIES_CODE === species) {
                        return acc + val.LANDED_WEIGHT_LBS
                    } else {
                        return acc
                    }
                }, 0)
                const percent_of_total = speciesWeight / totalWeight;
                const net_bleed_weight = percent_of_total * unsortedCatch;
                speciesWeights.push( // should these be calculated per haul, or for the whole trip?
                    {
                        PACFIN_SPECIES_CODE: species,
                        LANDED_WEIGHT_SUM: speciesWeight,
                        PERCENT_OF_TOTAL: percent_of_total,
                        NET_BLEED_WEIGHT: net_bleed_weight
                    });
            }
            console.log(speciesWeights);
            return [totalWeight, unsortedCatch, speciesWeights];
        }

        unsortedCatch(logbook, fishTickets);

        // evaluate catch docs
        // is source logbook, thirdParty, or nwfsc
            // logbook

            // thirdParty or nwfsc
        console.log('catch evaluated!!!');
        }, 3000
    )

}