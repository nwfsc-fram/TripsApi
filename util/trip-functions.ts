const jp = require('jsonpath');
import { cloneDeep, flattenDeep, set } from 'lodash';
import { getFishTicket } from './oracle_routines';
import { unsortedCatch, lostCodend, selectiveDiscards, discardMortalityRates, missingWeight, lostFixedGear } from '@boatnet/bn-expansions';
import { Catches, ResponseCatchTypeName, MinimalResponseCatchTypeName } from '@boatnet/bn-models';
import { format } from './formatter';
import * as moment from 'moment';
import { getMixedGroupingInfo } from './getMixedGroupings';
import { masterDev } from './couchDB';

export async function catchEvaluator(tripNum: number, expansionType: string) {
    //  wait for a while to be sure data is fully submitted to couch
    setTimeout(async () => {

        const codesQuery = await masterDev.view('em-views', 'wc2pc-map-with-pri-and-pro', { include_docs: false });
        const speciesCodeLookup = {};
        for (const row of codesQuery.rows) {
            speciesCodeLookup[row.key] = {
                translatedCode: row.value[0] ? row.value[0].toString() : '',
                isWcgopEmPriority: row.value[1],
                isProtected: row.value[2]
            };
        }

        // get trip
        const trip = await masterDev.view('TripsApi', 'all_api_trips', { "reduce": false, "key": tripNum, "include_docs": true }).then((body) => {
            if (body.rows.length > 0) {
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
        await masterDev.view('TripsApi', 'all_api_catch', { "reduce": false, "key": tripNum, "include_docs": true }).then((body) => {
            if (body.rows.length > 0) {
                const docs = body.rows.map((row) => row.doc);
                for (const doc of docs) {
                    if (doc.source === 'logbook') {
                        logbook = cloneDeep(doc);
                        jp.apply(logbook, '$.hauls..speciesCode', function(value) { return value.toString() });
                    } else if (doc.source === 'thirdParty') {
                        thirdParty = cloneDeep(doc);
                        jp.apply(thirdParty, '$.hauls..speciesCode', function(value) { return value.toString() });
                    } else if (doc.source === 'nwfscAudit') {
                        nwfscAudit = cloneDeep(doc);
                        jp.apply(nwfscAudit, '$.hauls..speciesCode', function(value) { return value.toString() });
                    }
                }
            } else {
                console.log('not found');
            }
        })

        // any review/audit catch in a general grouping that needs to be expanded to specific members?
        const mixedGroupings: any = await getMixedGroupingInfo();
        const mixGroupingKeys: string[] = Object.keys(mixedGroupings);

        try {
            if (logbook) {
                if (logbook.fishTickets) {
                    const nomDecoderSrc: any = await masterDev.view('obs_web', 'all_doc_types', {"reduce": false, "key": "nom-2-pacfin-decoder", "include_docs": true});
                    const nomDecoder = {};
                    for (const decoderRow of nomDecoderSrc.rows[0].doc.decoder) {
                        nomDecoder[decoderRow['nom-code']] = decoderRow['pacfin-code'];
                    }
                    for (const row of logbook.fishTickets) {
                        let fishTicketRows = await getFishTicket(row.fishTicketNumber);
                        fishTicketRows.map( (row: any) => {
                            row.PACFIN_SPECIES_CODE = nomDecoder[row.PACFIN_SPECIES_CODE] ?  nomDecoder[row.PACFIN_SPECIES_CODE] : row.PACFIN_SPECIES_CODE;
                        } )
                        fishTickets.push.apply(fishTickets, fishTicketRows);
                    }
                }
                logbook = cloneDeep(await evaluatecurrCatch(logbook, expansionType));
            }
            if (thirdParty) {
                thirdParty = cloneDeep(await evaluatecurrCatch(thirdParty, expansionType));
            }
            if (nwfscAudit) {
                nwfscAudit = cloneDeep(await evaluatecurrCatch(nwfscAudit, expansionType));
            }
            // then write all tripCatch docs to results doc
            let result: any = await format(tripNum, logbook, thirdParty, nwfscAudit, expansionType);
            let existingDoc = null;
            if (expansionType === ResponseCatchTypeName) {
                existingDoc = await masterDev.view('TripsApi', 'expansion_results',
                    { "key": tripNum, "include_docs": true });
            } else {
                existingDoc = await masterDev.view('TripsApi', 'minimal_expansion_results',
                { "key": tripNum, "include_docs": true });
            }

            if (existingDoc && existingDoc.rows.length !== 0) {
                let currDoc = existingDoc.rows[0].doc;
                set(result, 'revisionHistory', updateRevisionHistory(currDoc));
                set(result, '_id', currDoc._id);
                set(result, '_rev', currDoc._rev);
                set(result, 'updateDate', moment().format());
                set(result, 'createDate', currDoc.createDate);
            } else {
                set(result, 'createDate', moment().format());
            }
            await masterDev.bulk({ docs: [result] });
        } catch (err) {
            console.log(err);
        }

        async function evaluatecurrCatch(currCatch: Catches, expansionType: string) {
            let flattenedCatch: any[] = jp.query(currCatch, '$.hauls..catch');
            flattenedCatch = flattenDeep(flattenedCatch);

            // does any catch have a length and or a count but not a weight?
            if (flattenedCatch.find((row: any) => (row.speciesLength || row.speciesCount) && !row.speciesWeight)) {
                console.log('length or count without weight found.');
                //currCatch = weightFromLengthOrCount(currCatch);

                const missingWeightsExp: missingWeight = new missingWeight();
                currCatch = cloneDeep(missingWeightsExp.expand({ currCatch, fishTickets, logbook, speciesCodeLookup }));
            }

            // does catch contain pacific halibut, lingcod, or sablefish?
            if (expansionType === ResponseCatchTypeName && flattenedCatch.find((row: any) => ['PHLB', '101', 'LCOD', '603', 'SABL', '203'].includes(row.speciesCode.toString()))) {
                console.log('discard mortality rate species found');
                const dmr: discardMortalityRates = new discardMortalityRates();
                currCatch = cloneDeep(dmr.expand({ currCatch, speciesCodeLookup }));
            };

            // is any catch unsorted catch? ('UNST' or '999' speciesCode) (Net Bleed)?
            if (
                flattenedCatch.find((row: any) => ['UNST', '999'].includes(row.speciesCode.toString())) &&
                currCatch.hauls.find((row: any) => row.gear === 'trawl')
            ) {
                console.log('unsorted catch (net bleed) found');
                const unsortedCatchExp: unsortedCatch = new unsortedCatch();
                currCatch = cloneDeep(unsortedCatchExp.expand({ currCatch, fishTickets }));
            }

            // any fixed-gear haul have lost gear (gearLost > 0 )?
            if (expansionType === ResponseCatchTypeName && currCatch.hauls.find((row: any) => row.gearLost && row.gearLost > 0 && row.gear !== 'trawl')) {
                console.log('lost fixed gear found');
                const lostFixedGearExp: lostFixedGear = new lostFixedGear();
                currCatch = lostFixedGearExp.expand({ currCatch });
            }

            // any haul have lost codend (isCodendLost = true)?
            if (expansionType === ResponseCatchTypeName && currCatch.hauls.find((row: any) => row.isCodendLost && row.gear === 'trawl')) {
                console.log('lost trawl gear codend found');
                const lostCodendExp: lostCodend = new lostCodend();
                currCatch = cloneDeep(lostCodendExp.expand({ currCatch, speciesCodeLookup }));
            }

            if (flattenedCatch.find((row: any) => mixGroupingKeys.includes(row.speciesCode.toString())) && ['thirdParty', 'nwfscAudit'].includes(currCatch.source)) {
                console.log('selective discards found');
                const selectiveDiscardsExp: selectiveDiscards = new selectiveDiscards();
                currCatch = cloneDeep(selectiveDiscardsExp.expand({ currCatch, logbook, mixedGroupings, speciesCodeLookup }));
            }
            return currCatch;
        }

        // evaluate catch docs
        // logbook
        // any catch have a length and or a count but not a weight?  if true, perform weight from length/weight calcs
        // then pacific halibut (and lingcod and sablefish) - also mortality rate calc (dmr)
        // is any catch unsorted catch? ('UNST' or 999 speciesCode) (Net Bleed) perform unsorted catch calcs - do we also check fishery or gear (any trawl fishery (not pot, H&l or longline))
        // any haul have lost gear (gearLost > 0 ) for fixed-gear fisheries perform lost pots or hooks calcs (same lost pots calc)
        // any haul have lost codend (isCodendLost = true) - perform lost codend cals
        // review and audit
        // any catch have a length and or a count but not a weight?  if true, perform length/weight calcs
        // then pacific halibut (and lingcod and sablefish) - also mortality rate calc (dmr)
        // is any catch unsorted catch? ('UNST' or 999 speciesCode) (Net Bleed) perform unsorted catch calcs - do we also check fishery or gear (any trawl fishery (not pot, H&l or longline))
        // any haul have lost gear (gearLost > 0 ) for fixed-gear fisheries perform lost pots or hooks calcs (same lost pots calc)
        // any haul have lost codend (isCodendLost = true) - perform lost codend cals
        // any catch in a general grouping that needs to be expanded to specific members? - perform selective discards calcs

        console.log('catch evaluated!!!');
    }, 3000
    )

}

function updateRevisionHistory(currDoc: any): any[] {
    let revisionHistory: any[] = currDoc.revisionHistory;
    revisionHistory = revisionHistory ? revisionHistory : [];
    revisionHistory.unshift({
        updateDate: moment().format(),
        oldVal: {
            updateDate: currDoc.updateDate,
            createDate: currDoc.createDate,
            updatedBy: currDoc.updatedBy,
            logbookCatch: currDoc.logbookCatch,
            thirdPartyReviewCatch: currDoc.thirdPartyReviewCatch,
            nwfscAuditCatch: currDoc.nwfscAuditCatch,
            debitSourceCatch: currDoc.debitSourceCatch,
            ifqTripReporting: currDoc.ifqTripReporting
        }
    })
    return revisionHistory;
}
