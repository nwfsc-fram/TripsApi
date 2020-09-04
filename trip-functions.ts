const dbConfig = require('./dbConfig.json').dbConfig;
const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev');
const jp = require('jsonpath');
import { cloneDeep, flattenDeep, get, remove, set, uniqBy, uniq, setWith } from 'lodash';

import { getFishTicket } from './oracle_routines';
import { unsortedCatch, lostCodend, selectiveDiscards } from '@boatnet/bn-expansions';
import { Catches } from '@boatnet/bn-models';

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

        let logbook = null;
        let thirdParty = null;
        let nwfscAudit = null;
        let fishTickets = [];

        // get catch docs
        await masterDev.view('TripsApi', 'all_api_catch', {"reduce": false, "key": parseInt(tripNum, 10), "include_docs": true}).then((body) => {
            if ( body.rows.length > 0) {
                const docs = body.rows.map((row) => row.doc);
                for (const doc of docs) {
                    if (doc.source === 'logbook') {
                        logbook = cloneDeep(doc)
                    } else if (doc.source === 'thirdParty') {
                        thirdParty = cloneDeep(doc)
                    } else if (doc.source === 'nwfscAudit') {
                        nwfscAudit = cloneDeep(doc)
                    }
                }
            } else {
                console.log('not found');
            }
        })

        try {
            if (logbook) {
                if (logbook.fishTickets) {
                    for (const row of logbook.fishTickets) {
                        fishTickets.push.apply(fishTickets, await getFishTicket(row.fishTicketNumber));
                    }
                }
                logbook = cloneDeep( await evaluateTripCatch(logbook));
            }
            if (thirdParty) {
                thirdParty = cloneDeep( await evaluateTripCatch(thirdParty));
            }
            if (nwfscAudit) {
                nwfscAudit = cloneDeep( await evaluateTripCatch(nwfscAudit));
            }
            // then write all tripCatch docs to results doc
        } catch (err) {
            console.log(err);
        }

        async function evaluateTripCatch(tripCatch: Catches) {
            let flattenedCatch: any[] = jp.query(tripCatch, '$..catch');
            flattenedCatch = flattenDeep(flattenedCatch);

            // does any catch have a length and or a count but not a weight?
            if (flattenedCatch.find( (row: any) => (row.length || row.count) && !row.weight)) {
                console.log('length or count without weight found.');
                //tripCatch = weightFromLengthOrCount(tripCatch);
            }

            // does catch contain pacific halibut, lingcod, or sablefish?
            if (flattenedCatch.find ((row: any) => ['PHLB', '101', 'LCOD', '603', 'SABL', '203'].includes(row.speciesCode.toString()))) {
                console.log('mortality rate species found');
                // tripCatch = mortalityRateCalc(tripCatch);
            };

            // is any catch unsorted catch? ('UNST' or '999' speciesCode) (Net Bleed)?
            if (
                flattenedCatch.find( (row: any) => ['UNST', '999'].includes(row.speciesCode.toString())) &&
                tripCatch.hauls.find( (row: any) => ['1', '2', '3', '4', '5'].includes(row.gearTypeCode))
            ) {
                console.log('unsorted catch (net bleed) found');
                const unsortedCatchExp: unsortedCatch = new unsortedCatch();
                tripCatch = cloneDeep(unsortedCatchExp.rulesExpansion(tripCatch, fishTickets));
            }

            // any fixed-gear haul have lost gear (gearLost > 0 )?
            if (tripCatch.hauls.find( (row: any) => row.gearLost && row.gearLost > 0 && ['10', '19', '20'].includes(row.gearTypeCode)) ) {
                console.log('lost fixed gear found');
                //tripCatch = lostFixedGear(tripCatch);
            }

            // any haul have lost codend (isCodendLost = true)?
            if (tripCatch.hauls.find( (row: any) => row.isCodendLost && ['1', '2', '3', '4', '5'].includes(row.gearTypeCode))) {
                console.log('lost trawl gear codend found');
                const lostCodendExp: lostCodend = new lostCodend();
                tripCatch = cloneDeep(lostCodendExp.logbookExpansion(tripCatch));
            }

            // any review/audit catch in a general grouping that needs to be expanded to specific members?
            if (flattenedCatch.find( (row: any) => ['5000'].includes(row.speciesCode.toString())) && ['thirdParty', 'nwfscAudit'].includes(tripCatch.source)) {
                console.log('review general grouping found');
                const selectiveDiscardsExp: selectiveDiscards = new selectiveDiscards();
                tripCatch = cloneDeep(selectiveDiscardsExp.rulesExpansion(logbook, tripCatch));
            }

            return tripCatch;
        }

        // evaluate catch docs
            // logbook
                // any catch have a length and or a count but not a weight?  if true, perform weight from length/weight calcs
                    // then pacific halibut (and lingcod and sablefish) - also mortality rate calc (dmr)
                // is any catch unsorted catch? ('UNST' or 999 speciesCode) (Net Bleed) perform unsorted catch calcs - do we also check fishery or gearType (any trawl fishery (not pot, H&l or longline))
                // any haul have lost gear (gearLost > 0 ) for fixed-gear fisheries perform lost pots or hooks calcs (same lost pots calc)
                // any haul have lost codend (isCodendLost = true) - perform lost codend cals
            // review and audit
                // any catch have a length and or a count but not a weight?  if true, perform length/weight calcs
                    // then pacific halibut (and lingcod and sablefish) - also mortality rate calc (dmr)
                // is any catch unsorted catch? ('UNST' or 999 speciesCode) (Net Bleed) perform unsorted catch calcs - do we also check fishery or gearType (any trawl fishery (not pot, H&l or longline))
                // any haul have lost gear (gearLost > 0 ) for fixed-gear fisheries perform lost pots or hooks calcs (same lost pots calc)
                // any haul have lost codend (isCodendLost = true) - perform lost codend cals
                // any catch in a general grouping that needs to be expanded to specific members? - perform selective discards calcs

        console.log('catch evaluated!!!');
        }, 3000
    )

}
