const dbConfig = require('../dbConfig.json').dbConfig;
const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev');
const jp = require('jsonpath');
import { cloneDeep, filter, flattenDeep, set, uniq } from 'lodash';
import { getFishTicket } from './oracle_routines';
import { lostCodend } from '@boatnet/bn-expansions';
import { sourceType, ChangeLog, CatchResults } from '@boatnet/bn-models';
import { formatLogbook } from './formatter';
import * as moment from 'moment';

var diff = require('deep-diff');

export async function catchEvaluator(tripNum: string) {
    //  wait for a while to be sure data is fully submitted to couch
    setTimeout(async () => {

        // get trip
        const trip = await masterDev.view('TripsApi', 'all_api_trips', { "reduce": false, "key": parseInt(tripNum, 10), "include_docs": true }).then((body) => {
            if (body.rows.length > 0) {
                return body.rows.map((row) => row.doc)[0];
            } else {
                console.log('Doc with specified tripNum not found');
            }
        })

        // get catch docs
        const tripCatches = await masterDev.view('TripsApi', 'all_api_catch', { "reduce": false, "key": parseInt(tripNum, 10), "include_docs": true }).then((body) => {
            if (body.rows.length > 0) {
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
            if (tripCatch.source === sourceType.logbook) {
                logbook = cloneDeep(tripCatch)
            } else if (tripCatch.source === sourceType.thirdParty) {
                thirdParty = cloneDeep(tripCatch)
            } else if (tripCatch.source === sourceType.nwfscAudit) {
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

        function unsortedCatch(thirdPartyReview: any, fishTickets: any) { // calc performed per haul
            let catches: any[] = jp.query(thirdPartyReview, '$..catch');
            catches = flattenDeep(catches);

            let results = [];

            for (const haul of thirdPartyReview.hauls) {
                let haulCatches = jp.query(haul, '$..catch');
                const unsortedCatch = haulCatches.reduce((acc, val) => {
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
                const specieses = uniq(fishTickets.map((row: any) => row.PACFIN_SPECIES_CODE))

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
                    results.push( // should these be calculated per haul, or for the whole trip?
                        {
                            PACFIN_SPECIES_CODE: species,
                            LANDED_WEIGHT_SUM: speciesWeight,
                            PERCENT_OF_TOTAL: percent_of_total,
                            NET_BLEED_WEIGHT: net_bleed_weight,
                            haulNum: haul.haulNum
                        });
                }
            }
            console.log(results);
            return results;
        }

        let result: any = {};
        let updatedBy: string = '';
        if (logbook) {
            // TODO call expansion, right now calling lostCodend by default
            const expansionRule: lostCodend = new lostCodend();
            result = expansionRule.logbookExpansion(logbook);
            updatedBy = logbook.updatedBy;
        } else if (thirdParty) {
            // check which expansion to apply and apply it
            updatedBy = thirdParty.updatedBy;
        }
        result = formatLogbook(result);
        const existingDoc = await masterDev.view('TripsApi', 'expansion_results',
            { "key": tripNum, "include_docs": true });
        if (existingDoc.rows.length !== 0) {
            const currDoc = existingDoc.rows[0].doc;
            const changeLog: ChangeLog[] = computeChangeLog(currDoc, result, updatedBy);
            set(result, 'changeLog', changeLog);
            set(result, '_id', currDoc._id);
            set(result, '_rev', currDoc._rev);
        }
        await masterDev.bulk({ docs: [result] });

      //  unsortedCatch(thirdParty, fishTickets);

        // evaluate catch docs
        // is source logbook, thirdParty, or nwfsc
            // logbook

            // thirdParty or nwfsc
        console.log('catch evaluated!!!');
    }, 3000
    )

}

function computeChangeLog(currDoc: any, results: CatchResults, updatedBy: string): ChangeLog[] {
    let changeLog: ChangeLog[] = [];
    changeLog = currDoc.changeLog ? currDoc.changeLog : [];
    let differences = diff.diff(currDoc, results, (path, key) =>
        ~['_id', '_rev', 'createDate', 'updateDate', 'changeLog'].indexOf(key)
    );
    differences = differences ? differences : [];

    for (const difference of differences) {
        let oldVal: any, newVal: any, property: any;
        if (difference.kind === 'A') {
            property = difference.path.join('.') + difference.index;
            oldVal = difference.item.lhs;
            newVal = difference.item.rhs;
        } else {
            property = difference.path.join('.');
            oldVal = difference.lhs;
            newVal = difference.rhs;
        }
        changeLog.push({
            updatedBy, property, oldVal, newVal,
            updateDate: moment().format(),
            app: 'catch-api'
        });
    }
    return changeLog;
}

