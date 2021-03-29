const moment = require('moment');
const jp = require('jsonpath');

import { Catches, EmReviewSelectionRate, EMHaulReviewSelection, EmHaulReviewSelectionTypeName } from '@boatnet/bn-models';
import { cloneDeep, isEqual, differenceWith, sampleSize, sortBy } from 'lodash';
import { masterDev } from '../util/couchDB';

export async function selectHaulsForReview(logbook: Catches) {
    try {
        const tripNum = logbook.tripNum;
        const logbookHaulNums = sortBy(jp.query(logbook, '$.hauls[*].haulNum'));

        const existingSelectionQuery = await masterDev.view(
            'TripsApi',
            'em-haul-review-selection-by-tripNum',
            {include_docs: true, reduce: false, key: tripNum}
        );
        const existingSelection = existingSelectionQuery.rows ? existingSelectionQuery.rows[0].doc : null;

        if (existingSelection) {
            const diff = differenceWith(existingSelection.logbookHauls, logbookHaulNums, isEqual);
            if (diff.length === 0) {
                console.log('hauls haven\'t changed - selection not nescessary.')
                return;
            }
        }

        const selectionRateQuery = await masterDev.view(
            'obs_web',
            'all_doc_types',
            {include_docs: true, reduce: false, key: 'em-review-selection-rate'}
        );
        const currentSelectionRateInfo: EmReviewSelectionRate = selectionRateQuery.rows.find(
            (row: any) => row.doc.isActive === true
        ).doc;

        const otsTripQuery = await masterDev.view(
            'obs_web',
            'ots_trips_by_tripNum',
            {include_docs: true, key: tripNum}
        );
        const otsTrip = otsTripQuery.rows[0].doc;

        let selectedHauls = [];
        let notes = '';

        let fisherySector = null;
        let maximizedRetention = null;

        if (otsTrip.maximizedRetention) {
            selectedHauls = cloneDeep(logbookHaulNums),
            notes = 'All hauls selected becuase trip is maxRetention';
            maximizedRetention = true;
        } else if (otsTrip.fisherySector && currentSelectionRateInfo.exemptions.includes(otsTrip.fisherySector.description)) {
            selectedHauls = cloneDeep(logbookHaulNums);
            notes = 'All hauls selected fishery sector is ' + otsTrip.fisherySector.description;
            fisherySector = otsTrip.fisherySector;
        } else {
            let numHaulsToSelect = Math.round(logbookHaulNums.length * (currentSelectionRateInfo.rate / 100));
            if (numHaulsToSelect < 1) {
                numHaulsToSelect = 1;
            };

            selectedHauls = sortBy(sampleSize(logbookHaulNums, numHaulsToSelect));

            notes = 'hauls ' + selectedHauls + ' selected based on selection rate'
        }

        const haulReviewSelection: EMHaulReviewSelection = {
            type: EmHaulReviewSelectionTypeName,
            tripNum,
            vesselName: otsTrip.vessel.vesselName,
            vesselNumber: otsTrip.vessel.coastGuardNumber ? otsTrip.vessel.coastGuardNumber : otsTrip.vessel.stateRegulationNumber,
            logbookHauls: logbookHaulNums,
            selectedHauls: selectedHauls,
            selectionRate: currentSelectionRateInfo.rate,
            selectionDate: moment().format(),
            dueDate: moment().add(14, 'days').format(),
            fishery: otsTrip.fishery,
            fisherySector,
            maximizedRetention,
            notes,
            provider: logbook.provider
        }

        if (existingSelection) {
            haulReviewSelection._id = existingSelection._id;
            haulReviewSelection._rev = existingSelection._rev;
        }

        const result = await masterDev.bulk({ docs: [haulReviewSelection] })
        console.log(result);
    } catch (err) {
        console.error(err);
    }
}
