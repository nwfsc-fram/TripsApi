const express = require('express');
const router = express.Router();

const utils = require('../security.utils.ts');
const axios = require('axios');
const request = require('request');

const nodemailer = require('nodemailer');
const mailConfig = require('../dbConfig.json').mailConfig;
const taskAuthorization = require('../dbConfig.json').taskAuthorization;
const frslUrl = require('../dbConfig.json').frslUrl;

const https = require('https');

const fs = require('fs');
const multiparty = require('multiparty');

import * as pemjwk from 'pem-jwk';
import { Request, Response, NextFunction } from 'express';

const DEFAULT_APPLICATION_NAME = 'BOATNET_OBSERVER';

const moment = require('moment');

const path = require('path');
import { resolve } from 'path';

import { validateJwtRequest } from '../get-user.middleware';
import { getFishTicket, vmsDBTest, insertRow, getVesselSelections, fishTicketQuery, getVesselFishTickets, getOracleTrips, checkPasscode, getRecentDeclarations } from '../util/oracle_routines';
import { catchEvaluator } from '../util/trip-functions';
import { Catches, sourceType, EmReviewSelectionRate, EMHaulReviewSelection, EmHaulReviewSelectionTypeName } from '@boatnet/bn-models';
import { set, cloneDeep, omit, pick, union, keys, reduce, isEqual, differenceBy, differenceWith, sampleSize, sortBy } from 'lodash';
import { ResponseCatchTypeName, MinimalResponseCatchTypeName } from '@boatnet/bn-models';

import { masterDev, dbConfig } from '../util/couchDB';

import { stringParser } from '../util/string-parser';
import { validateCatch, validateApiTrip } from '../util/validator';
import { runTripErrorChecks } from '../util/tripChecks';
import { selectHaulsForReview } from '../util/haulSelection';
import { waivers } from '../data-access-lib/waivers';
import { mongo } from '../util/mongoClient';

let token = '';
export let key = '';
const jp = require('jsonpath');

export enum databaseClient {
    Couch = "couch",
    Mongo = "mongo",
    Oracle = "oracle"
}

const login = async (req, res) => {
    let username = req.body.username || '';
    const password = req.body.passwordEnc
      ? utils.decode64(req.body.passwordEnc)
      : req.body.password || '';

    const applicationName = req.body.applicationName
    ? req.body.applicationName.toUpperCase()
    : DEFAULT_APPLICATION_NAME;

    username = username.toLowerCase();

    if (username === '' || password === '') {
        res.status(401);
        res.json({
          status: 401,
          message: 'Invalid credentials - missing inputs.'
        });
        console.log('Missing user or pw.');
        return false;
      }

    await request.post({
        url: dbConfig.authServer + 'api/v1/login',
        json: true,
        body: {
                "username": username,
                "password": password,
                "applicationName": applicationName
            },
        rejectUnauthorized: false,
        requestCert: false,
        agent: false,
    }, function (err, response, body) {
        if (err) {
            console.log(err);
        }

        if (body.token.length > 0) {
            token = body.token;

            res.send({
                "token": token
            })
        } else {
            res.status(500).send(err);
        }
    })

}

async function getPubKey (
    req: Request,
    res: Response,
    next: NextFunction) {
    if (key === '') {
        await request.get({
            url: dbConfig.authServer + 'api/v1/pubkey',
            rejectUnauthorized: false,
            requestCert: false,
            agent: false,
        }, function (err, response, body) {
            key = pemjwk.jwk2pem(JSON.parse(body).keys[0])
            next();
        })
    } else {
        next();
    }
}

const getTrips = async (req, res) => {
    let response = [];

    const evaluateBody = (body) => {
        if (body.rows.length > 0) {
            response = body.rows.map( (row: any) => pick(row.doc, ['vesselId', 'vesselName', 'departurePort', 'departureDate', 'returnPort', 'returnDate', 'fishery', 'permits', 'tripNum']));
        }
    }

    const filter = () => { // filter results based on all queries
        // if (req.query.vesselId) { response = response.filter( (row: any) => row.vesselId.toLowerCase().includes(req.query.vesselId.toLowerCase()) ); } // has no impact
        if (req.query.vesselName) { response = response.filter( (row: any) => row.vesselName.toLowerCase().includes(req.query.vesselName.toLowerCase()) ); }
        if (req.query.departurePort) { response = response.filter( (row: any) => row.departurePort.toLowerCase().includes(req.query.departurePort.toLowerCase()) ); }
        if (req.query.returnPort) { response = response.filter( (row: any) => row.returnPort.toLowerCase().includes(req.query.returnPort.toLowerCase()) ); }
        if (req.query.fishery) { response = response.filter( (row: any) => row.fishery.toLowerCase().includes(req.query.fishery.toLowerCase()) ); }
        if (req.query.permit) { response = response.filter( (row: any) => row.permits && Array.isArray(row.permits) && row.permits.includes(req.query.permit) ); }
        if (req.query.departureDate) { response = response.filter( (row: any) => moment(row.departureDate).isSame(req.query.departureDate, 'day') ); }
        if (req.query.returnDate) { response = response.filter( (row: any) => moment(row.returnDate).isSame(req.query.returnDate, 'day') ); }
        if (req.query.before) { response = response.filter( (row: any) => moment(row.departureDate).isBefore(req.query.before, 'day') ); }
        if (req.query.after) { response = response.filter( (row: any) => moment(row.departureDate).isAfter(req.query.after, 'day') ); }
        if (req.query.year) { response = response.filter( (row: any) => moment(row.departureDate).isSame(req.query.year, 'year') || moment(row.returnDate).isSame(req.query.year, 'year')); }
    }

    if (req.query.vesselId) { // choose the best view for the query
        await masterDev.view('TripsApi', 'api_trips_by_vesselId', {reduce: false, descending: true, include_docs: true, key: req.query.vesselId}).then((body) => evaluateBody(body))
    } else if (req.query.vesselName) {
        await masterDev.view('TripsApi', 'api_trips_by_vesselName', {reduce: false, descending: true, include_docs: true, key: req.query.vesselName}).then((body) => evaluateBody(body))
    } else if (req.query.departureDate) {
        await masterDev.view('TripsApi', 'api_trips_by_departureDate', {reduce: false, descending: true, include_docs: true, start_key: req.query.departureDate}).then((body) => evaluateBody(body))
    } else if (req.query.departurePort) {
        await masterDev.view('TripsApi', 'api_trips_by_departurePort', {reduce: false, descending: true, include_docs: true, start_key: req.query.departurePort}).then((body) => evaluateBody(body))
    } else {
        await masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "descending": true, include_docs: true}).then((body) => evaluateBody(body))
    }

    filter();

    if (response.length > 0) {
        res.status(200).send(response);
    } else {
        res.status(400).send('no matching results found');
    }

}

const newCruise = async (req, res) => {
    if (req.body.vesselId) {
        const queryOptions = {
            "reduce": false,
            "descending": true,
            "limit": 1
        }
        await masterDev.view('TripsApi', 'all_api_cruise', queryOptions).then((body) => {
            const newCruise = req.body
            newCruise.type = 'cruise-api'
            let maxId: number = 100000;
            if (body.rows[0]) {
                maxId = body.rows[0].key + 1;
            }
            newCruise.cruiseNum = maxId;
            const cruiseQueryOptions = {
                "reduce": false,
                "key": maxId,
                "include_docs": true
            }
            masterDev.bulk({docs: [newCruise]}).then(
                setTimeout(() => {
                    masterDev.view('TripsApi', 'all_api_cruise', cruiseQueryOptions).then((result) => {
                        res.send(
                            {
                                cruiseNum: maxId,
                                cruise: result.rows[0].doc
                            }
                        )
                    })
                }, 500)
            )
          });
    } else {
        res.status(400).send('vesselID is required to create a new cruise.')
    }
}

const newTrip = async (req, res) => {
    if (req.headers['content-type'] == "application/xml") { stringParser(req); }
    if (req.body.vesselId && typeof req.body.vesselId === 'string' && req.body.departureDate && req.body.returnDate) {
        let warnings = '';
        await masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "descending": true, "limit": 1}).then( async (body) => {
            const maxId = body.rows[0].key
            const newTrip: any = pick(req.body, [
                'departureDate',
                'returnDate',
                'departurePort',
                'returnPort',
                'fishery',
                'permits',
                'vesselName',
                'vesselId',
                'captain'
            ])
            newTrip.type = 'trips-api'
            newTrip.tripNum = maxId + 1
            newTrip.createdBy = req.res && req.res.user ? req.res.user.username : 'unknown';
            newTrip.createdDate = moment().format();
            newTrip.changeLog = [];
            const validationResults = await validateApiTrip(newTrip, 'new');
            if (validationResults) {
                if (Object.keys(validationResults).includes('vesselId') && Object.keys(validationResults).length == 1 ) {
                    warnings += 'vessel Id not found (but trip was accepted)';  // warn but don't reject
                } else {
                    res.status(400).send(validationResults); // reject submisssion
                    return;
                }
            }
            masterDev.bulk({docs: [newTrip]}).then(
                setTimeout(() => {
                    masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": maxId + 1, "include_docs": true}).then((result) => {

                        res.send(
                            {
                                tripNum: maxId + 1,
                                trip: result.rows[0].doc,
                                warnings
                            }
                        )
                    })
                }, 500)
            )
            });
    } else {
        res.status(400).send('missing required data.  vesselId (string), departureDate, and returnDate are required.')
    }
}

const getTrip = async (req, res) => {
    const tripNum = parseInt(req.params.tripNum, 10)
    await masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": tripNum, "include_docs": true}).then((body) => {
        if ( body.rows.length > 0 ) {
            res.json(pick(body.rows[0].doc, [
                                        'tripNum',
                                        'vesselId',
                                        'vesselName',
                                        'departureDate',
                                        'returnDate',
                                        'departurePort',
                                        'returnPort',
                                        'fishery',
                                        'permits',
                                        'changeLog',
                                        'createdBy',
                                        'createdDate',
                                        'updatedBy',
                                        'updatedDate',
                                        'status',
                                        'captain',
                                        '_id'
                                            ]));
        } else {
            res.send('Doc with tripNum: ' + tripNum + ' not found')
        }
    })
}

const updateTrip = async (req, res) => {
    const tripNum = parseInt(req.params.tripNum, 10);
    let warnings = '';
    if (req.headers['content-type'] == "application/xml") { stringParser(req); }
    await masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": tripNum, "include_docs": true}).then( async (body) => {
        if ( body.rows.length > 0 ) {
            let existingDoc = body.rows[0].doc;
            if (existingDoc.status && existingDoc.status === 'cancelled') {
                res.status(400).send('Trip ' + tripNum + ' has been cancelled - it can not be updated');
                return;
            }
            if (!existingDoc.changeLog) {
                existingDoc.changeLog = [];
            }

            let newDoc = pick(req.body, ['departureDate', 'returnDate', 'departurePort', 'returnPort', 'fishery', 'permits', 'vesselName', 'status', 'captain']);

            const validationResults = await validateApiTrip(newDoc, 'update');
            if (validationResults) {
                res.status(400).send(validationResults); // reject submisssion
                return;
            }

            const difference = reduce(keys(newDoc), (result: any, key) => {
                if ( !isEqual(existingDoc[key], newDoc[key]) ) {
                    result[key] = {previousValue: existingDoc[key], newValue: newDoc[key]};
                    existingDoc[key] = newDoc[key];
                }
                return result;
            }, {});
            if (keys(difference).length > 0) {
                existingDoc.changeLog.unshift({
                        changedBy: req.res && req.res.user ? req.res.user.username : 'unknown',
                        changedDate: moment().format(),
                        changes: difference
                    })
            }
            existingDoc.updatedBy = req.res && req.res.user ? req.res.user.username : 'unknown';
            existingDoc.updatedDate = moment().format();
            console.log(existingDoc);
            masterDev.bulk({docs: [existingDoc]}).then( (body) => {
                res.status(200).send(body);
            })
        } else {
            res.status(400).send('Trip ID:' + req.body._id + ' not found.');
        }
    })
}

const getCatch = async (req, res) => {
    masterDev.view('TripsApi', 'all_api_catch', {"reduce": false, "key": parseInt(req.params.tripNum, 10), "include_docs": true}).then((body) => {
        if ( body.rows.length > 0) {
            const docs = body.rows.map((row) => row.doc)
            res.json(docs)
        } else {
            res.status(200).send('not found')
        }
    })
}



const newCatch = async (req, res) => {
    if (req.headers['content-type'] == "application/xml") { stringParser(req); }
    setTimeout(async () => {
        const tripNum: number = parseInt(req.params.tripNum, 10);
        if (tripNum && req.body.source && req.body.hauls) {
            const newTrip = req.body;
            newTrip.type = 'trips-api-catch';
            newTrip.createdDate = moment().format();
            newTrip.createdBy = req.res && req.res.user ? req.res.user.username : 'unknown';
            newTrip.revision = 0;
            newTrip.history = [];

            // check trip doc for tripNum exists
            const tripDocs = await masterDev.view('TripsApi', 'all_api_trips', { "key": tripNum });
            if (tripDocs.rows.length === 0 ) {
                res.status(400).send('Trip doc with tripNum: ' + tripNum + ' does not exist. ' +
                    'Please create a valid trip before submitting catch.');
                return;
            }

            const otsTripQuery = await masterDev.view('obs_web', 'ots_trips_by_tripNum', {"key": tripNum, "include_docs": true});
            const otsTrip = otsTripQuery.rows.length > 0 ? otsTripQuery.rows[0].doc : null;

            const catchDocs = await masterDev.view('TripsApi', 'all_api_catch', { "key": tripNum, "include_docs": true });
            const catchDoc = catchDocs.rows.filter((row) => row.doc.source === req.body.source);

            if (req.body.source === 'logbook') {
                await checkOtsTripStatus(req.body.tripNum, res);
            }

            if (req.body.source === 'logbook' && catchDocs.rows.some( (row: any) => row.doc.source === 'thirdParty' )) {
                emailEMContact(req, 'attempted logbook submission after review submission');
                res.status(400).send('Logbook info may not be submitted/updated via API after review data has been submitted.  Please contact NMFS.');
                return;
            }

            if (catchDoc.length > 0) {
                res.status(400).send('Catch doc with tripNum:' + tripNum + ' already exists. ' +
                    'Please submit updated data via PUT to /tripCatch/:tripNum');
                return;
            } else {
                // additional validation checks
                const validationResults = await validateCatch(newTrip, tripNum, otsTrip);
                if (validationResults.status != 200) {
                    res.status(validationResults.status).send(validationResults.message);
                    return;
                }
                const errors: string = validationResults.catchVal.errors && validationResults.catchVal.errors.length > 0 ? ' Errors: ' + JSON.stringify(validationResults.catchVal.errors) : '';

                // everything is good, write to db and evaluate catch doc
                masterDev.bulk({ docs: [validationResults.catchVal] }).then(
                    () => {
                        if (validationResults.catchVal.source === 'logbook') {
                            selectHaulsForReview(validationResults.catchVal);
                        };
                        catchEvaluator(tripNum, ResponseCatchTypeName);
                        catchEvaluator(tripNum, MinimalResponseCatchTypeName);
                        res.status('200').send('Catch doc with tripNum:' + tripNum + ' saved successfully. ' + errors);
                        return;
                });
            }

        } else {
            res.status(400).send('missing required parameters.');
            return;
        }
    }, 300)
}

const evalCatch = async (req, res) => {
    const tripNum = parseInt(req.params.tripNum, 10);
    try {
        await catchEvaluator(tripNum, ResponseCatchTypeName);
        await catchEvaluator(tripNum, MinimalResponseCatchTypeName);
        res.status(200).send('Catch doc with tripNum:' + tripNum + ' successfully evaluated');
    } catch (err) {
        res.status(500).send('Something went wrong - unable to evaluate catch for trip number ' + tripNum + ' Error: ' + err);
    }
}


const updateCatch = async (req, res) => {
    if (req.headers['content-type'] == "application/xml") { stringParser(req); }
    const tripNum = parseInt(req.params.tripNum, 10);

    // check catch doc with same tripNum exist
    const catchDocs = await masterDev.view('TripsApi', 'all_api_catch', { "key": tripNum, "include_docs": true });
    if (catchDocs.rows.length === 0) {
        res.status(400).send('Catch doc with tripNum ' + tripNum + ' does not exist.' +
        'Please use POST to /tripCatch/:tripNum to submit new catch data.');
        return;
    }

    if (req.body.source === 'logbook') {
        await checkOtsTripStatus(req.body.tripNum, res);
    }

    if (req.body.source === 'logbook' && catchDocs.rows.some( (row: any) => row.doc.source === 'thirdParty' )) {
        emailEMContact(req, 'Attempted logbook submission after review submission');
        res.status(400).send('Logbook info may not be submitted/updated via API after review data has been submitted.  Please contact NMFS.');
        return;
    }

    // get catchDocs with same source type as one specified in the request
    const catchDoc = catchDocs.rows.filter((row) => row.doc.source === req.body.source);
    if (catchDoc.length === 0) {
        res.status(400).send('Catch doc with tripNum: ' + tripNum + ' and source: ' + req.body.source +
            ' does not exist please submit new catch via POST to /tripCatch/:tripNum');
        return;
    }

    const couchDoc = catchDoc[0].doc;
    const updateDoc: any = req.body;

    // additional validation checks
    const validationResults = await validateCatch(updateDoc, tripNum);
    if (validationResults.status != 200) {
        res.status(validationResults.status).send(validationResults.message);
        return;
    }

    // doc valid, save to couch
    const reqDoc: any = validationResults.catchVal;
    set(reqDoc, '_id', couchDoc._id);
    set(reqDoc, '_rev', couchDoc._rev);
    set(reqDoc, 'type', 'trips-api-catch');
    set(reqDoc, 'createdDate', couchDoc.createdDate);
    set(reqDoc, 'updateDate', moment().format());
    set(reqDoc, 'revision', couchDoc.revision ? couchDoc.revision + 1 : 1);
    set(reqDoc, 'resubmission', true);
    set(reqDoc, 'history', []);
    if (couchDoc.history) {
        set(reqDoc, 'history', cloneDeep(couchDoc.history));
    };
    reqDoc.history.push(cloneDeep(omit(couchDoc, ['history']))); // don't store history array in history versions
    const errors: string = reqDoc.errors && reqDoc.errors.length > 0 ? ' Errors: ' + JSON.stringify(reqDoc.errors) : '';
    masterDev.bulk({ docs: [reqDoc] }).then((body) => {
        if (validationResults.catchVal.source === 'logbook') {
            selectHaulsForReview(validationResults.catchVal);
        };
        catchEvaluator(tripNum, ResponseCatchTypeName);
        catchEvaluator(tripNum, MinimalResponseCatchTypeName);
        res.status(200).send('Catch doc with tripNum:' + tripNum + ' successfully updated!' + errors);
    })
}

const checkOtsTripStatus = async (tripNum, res) => {
    const otsTrip = await masterDev.view(
        'obs_web',
        'ots_trips_by_tripNum',
        {reduce: false, include_docs: true, key: tripNum} as any
    )

    if (otsTrip.rows[0]) {
        if (!(otsTrip.rows[0].doc.tripStatus && otsTrip.rows[0].doc.tripStatus.description === 'closed')) {
            res.status(400).send('error - trip not closed - please close trip prior to catch submission.');
            return;
        } else if (!otsTrip.rows[0].doc._attachments) {
            res.status(400).send('error - missing logbook image capture - please add image prior to catch submission.');
            return;
        }
    } else {
        res.status(400).send('error - missing trip info - please log trip (with logbook image) prior to catch submission.');
        return;
    }
}

const saveScreenshot = async (req, res) => {
    if (!req.params.tripNum || !req.query.haulNum || !req.query.timeStamp || !req.query.submissionReason) {
        res.status(400).send('submission rejected - missing required data');
    }

    const tripNum: number = parseInt(req.params.tripNum, 10);
    let uploads = [];

    const tripDocs = await masterDev.view('TripsApi', 'all_api_trips', { "key": tripNum });
    if (tripDocs.rows.length === 0 ) {
        res.status(400).send('Trip doc with tripNum: ' + tripNum + ' does not exist. ' +
            'Please create a valid tripDoc before submitting screenshot(s).');
    } else {
        const newScreenshot: any = {
            type: 'emReviewScreenshot',
            tripNum,
            _attachments: {},
            createdDate: moment().format(),
            createdBy: req.res && req.res.user ? req.res.user.username : '',
            haulNum: req.query.haulNum,
            timeStamp: req.query.timeStamp,
            submissionReason: req.query.submissionReason
        };

        if (req.query.speciesCode) { newScreenshot.speciesCode = req.query.speciesCode };
        if (req.query.description) { newScreenshot.description = req.query.description };

        new Promise( ( resolve, reject) => {
            var form = new multiparty.Form();
            form.parse(req, function(err, fields, files) {
                for (const item of files.files) {
                    uploads.push({filename: item.originalFilename, path: item.path, type: item.headers['content-type']})
                }
                resolve(1)
            })
        }).then(
            () => {
            new Promise( (resolve, reject) => {
                for (const upload of uploads) {
                    newScreenshot._attachments[upload.filename] =
                        {
                            content_type: upload.type,
                            data: fs.readFileSync(upload.path).toString('base64')
                        }
                }
                resolve(2)
            }).then( async () => {
                    await masterDev.bulk({ docs: [newScreenshot] }).then(
                        () => {
                            res.status('200').send('Screenshot(s) for tripNum:' + tripNum + ' EM review saved successfully.');
                        })
                })
            }
        )
        return;
    }
}


import * as jsonexport from "jsonexport/dist";

const getLookups = async (req, res) => {
    const lookupResults = await masterDev.view('TripsApi', 'all_em_lookups', {include_docs: false, reduce: false });
    let lookupTranslations: any = {
        'em-source': 'source',
        'port': 'departurePort / returnPort',
        'us-state': 'departureState / returnState',
        'calc-weight-type': 'calcWeightType',
        'catch-disposition': 'disposition',
        'fate': 'fate',
        'fishery-sector': 'fisherySector',
        'gear': 'gear',
        'net-type': 'netType',
        'catch-handling-performance': 'catchHandlingPerformance',
        'system-performance': 'systemPerformance',
        'review-species': 'speciesCode (review)',
        'logbook-species': 'speciesCode (logbook)',
        'target-strategy': 'targetStrategy'
    }
    let formatted = [];
    for (const row of lookupResults.rows) {
        formatted.push(
            {
                "type":  Object.keys(lookupTranslations).includes(row.key) ? lookupTranslations[row.key] : row.key ,
                "description": row.value[0].replace(/,/g, ' -'),
                "lookup": row.value[1]
            }
        )
    };
    const csv = await jsonexport(formatted);

    res.status(200).render('em-lookups', {lookupResults, csv});
}

const getTripsLookups = async (req, res) => {
    const lookupResults = await masterDev.view('TripsApi', 'all_trips_lookups', {include_docs: false, reduce: false});
    const lookupTranslations: any = {
        'port': 'departurePort / returnPort'
    };
    let formatted = [];
    for (const row of lookupResults.rows) {
        formatted.push(
            {
                "type":  Object.keys(lookupTranslations).includes(row.key) ? lookupTranslations[row.key] : row.key ,
                "description": row.value[0].replace(/,/g, ' -'),
                "lookup": row.value[1]
            }
        )
    }
    const csv = await jsonexport(formatted);
    res.status(200).render('trips-lookups', {lookupResults, csv});
}

const getInstructions = async (req, res) => {
    const exampleLogbook = await masterDev.view('TripsApi', 'all_api_catch', {include_docs: true, reduce: false, key: 100001})
    res.status(200).render('instructions-main', {path: path.resolve(__dirname.replace('\\routes', '')), exampleLogbook: exampleLogbook.rows[0].doc});
};

const getProgram = async (req, res) => {
    res.status(200).render('program');
};

const getDocs = async (req, res ) => {
    res.status(200).render('docs');
}

// const insertObsprodRow = async (req, res) => {
//     const response = await insertRow();
//     console.log(response)
//     res.status(200).send('see console');
// }

const getRolloverStatus = async (selection: any, allWaivers: any) => {
    if (moment(selection.PERIOD_END).isBefore(moment(), 'year')) {
        return "- previous year";
    } else if ( moment(selection.PERIOD_END).isBefore(moment()) ) {
        const trips = await getOracleTrips(selection.VESSEL_DRVID, moment(selection.PERIOD_START).format('DD-MMM-YY'), moment().format('DD-MMM-YY')) as any;
        trips.sort( (a: any, b: any) => {
            return a.RETURN_DATE > b.RETURN_DATE ? 1 : a.RETURN_DATE < b.RETURN_DATE ? -1 : 0;
        } );
        let fishTickets: any[] = [];
        try {
            fishTickets = await getVesselFishTickets(selection.VESSEL_DRVID, moment(selection.PERIOD_START).format('YYYY-MM-DD'), moment().format('YYYY-MM-DD')) as any;
        } catch (err) {
            console.log(err);
        }
        if (trips.length > 0) {
            // const allTripsticketNumbers = jp.query(trips, '$..fishTicketNumber');
            for (const trip of trips) {
                if (trip.FISHERY === selection.FISHERY) {
                    if (trip.FISH_TICKETS && trip.FISH_TICKETS.split(',')[0]) {
                        for (const ticket of trip.FISH_TICKETS.split(',')) {
                            let tripTicket = null;
                            if (fishTickets) {
                                tripTicket = fishTickets.find( (row: any) => row.FTID === ticket || row.FTID === ticket + 'E');
                            }
                            if (tripTicket && tripTicket.LANDED_WEIGHT_LBS && tripTicket.LANDED_WEIGHT_LBS > 0) {
                                return "N - observed w/ landed lbs - " + moment(tripTicket.LANDING_DATE).format('MM/DD/YYYY');
                            }
                        }
                    }
                }
            }
            if (!selection.rolloverStatus) {
                return "Y - no landed lbs";
            }
        } else {
            let licenseNums = [];
            if (fishTickets) {
                licenseNums = [ ...new Set(fishTickets.map( (row: any) => row.FISHER_LICENSE_NUM ).filter( (lic: any) => lic !== null ))];
            }

            if (licenseNums.length > 0 && selection.LICENSE_NUMBER && licenseNums.includes( selection.LICENSE_NUMBER ) ) {
                // get waivers for period
                if (allWaivers.map( (row: any) => row.PERMIT_OR_LICENSE || row.certificateNumber ).find( (num: any) => num === selection.LICENSE_NUMBER )) {
                    return "Possibly Waived";
                } else {
                    return "Possible Out of Compliance";
                }
            } else {
                return "Y - no observerd trips";
            }
        }
    } else if ( moment(selection.PERIOD_START).isBefore(moment()) && moment(selection.PERIOD_END).isAfter(moment()) ) {
        return "- in period";
    } else {
        return "- before period";
    }
}

const rolloverCheck = async (req, res) => {
    if (req.query.taskAuthorization === taskAuthorization) {
        res.status(200).send('executing rollover check');
        const year = moment().format('YYYY');
        const allWaivers = await waivers.getByIdAndYear(null, year, databaseClient.Oracle);
        const allVesselSelections = await getVesselSelections(year);
        let statusDoc = null;
        let statusesQuery = await masterDev.view(
            'obs_web',
            'all_doc_types',
            {'key': 'fleet-rollover-statuses', reduce: false, include_docs: true} as any
        )
        if (statusesQuery.rows.length > 0) {
            statusDoc = statusesQuery.rows[0].doc;
            statusDoc.statuses = {};
        } else {
            statusDoc = {
                type: 'fleet-rollover-statuses',
                year,
                statuses: {}
            }
        }
        const startTime = moment().format();
        var length = allVesselSelections.length;
        for (const selection of allVesselSelections) {
            console.log(allVesselSelections.indexOf(selection) + 1 + ' of ' + length)
            const status = await getRolloverStatus(selection, allWaivers);
            if (status) {
                statusDoc.statuses[selection.VESSEL_DRVID + '-' + selection.FISHERY + '-' + moment(selection.PERIOD_END).format('MM-DD-YYYY')] = status;
            }
        }
        statusDoc.lastRun = moment().format();
        const endTime = moment().format();
        statusDoc.executionTime = moment(endTime).diff(startTime, 'seconds');
        await masterDev.bulk({docs: [statusDoc]});
        console.log('done');
    } else {
        res.status(400).send('task authorization not found in request');
    }
}

const updateBuyers = async (req, res) => {
    if (req.query.taskAuthorization === taskAuthorization) {
        request.get({
            url: frslUrl,
            rejectUnauthorized: false,
            requestCert: false,
            agent: false,
        }, async function (err, response, body) {
            const buyersQuery = await masterDev.view('obs_web', 'all_doc_types', {include_docs: true, reduce: false, key: "buyer"});

            const couchBuyers = buyersQuery.rows.map( (row: any) => row.doc ) ;
            const couchCompareBuyers = buyersQuery.rows.map( (row: any) => pick(row.doc, ['permit_number', 'license_number', 'license_start_date', 'license_end_date', 'license_owner', 'processing_plant_city', 'processing_plant_state', 'designation'] ) )
            const sdmBuyers = JSON.parse(body).items.map( (row) =>  pick(row, ['permit_number', 'license_number', 'license_start_date', 'license_end_date', 'license_owner', 'processing_plant_city', 'processing_plant_state', 'designation']));

            const differenceFromCouch = differenceWith(sdmBuyers, couchCompareBuyers, isEqual)
            if (differenceFromCouch.length > 0) {
                for (var differenceRow of differenceFromCouch) {
                    var couchDoc = couchBuyers.find( (couchRow: any) => couchRow.permit_number === differenceRow.permit_number );
                    if (couchDoc) {
                        const id = couchDoc._id;
                        const rev = couchDoc._rev;
                        couchDoc = differenceRow;
                        couchDoc._id = id;
                        couchDoc._rev = rev
                        couchDoc.type = "buyer"
                        couchDoc.isActive = true;
                        couchDoc.isEm = true;
                        couchDoc.updatedDate = moment().format();
                        await masterDev.bulk({docs: [couchDoc]});
                    } else {
                        differenceRow.type = "buyer"
                        differenceRow.isActive = true;
                        differenceRow.isEm = true;
                        differenceRow.createdDate = moment().format();
                        await masterDev.bulk({docs: [differenceRow]})
                    }
                }
            };

            const differenceFromSdm = differenceWith(couchCompareBuyers, sdmBuyers, isEqual);
            if (differenceFromSdm.length > 0) {
                for (var differenceRow of differenceFromSdm) {
                    var couchDoc = couchBuyers.find( (couchRow: any) => couchRow.permit_number === differenceRow.permit_number );
                    if (couchDoc) {
                        masterDev.destroy(couchDoc._id, couchDoc._rev);
                    }
                }
            };

            res.status(200).send(
                'couch buyers updated'
            );
        }, function (err, response, body) {
            res.status(500).send(err);
        });
    } else {
        res.status(401).send('not authorized');
    }
}

const emailEMContact = async (req, alert) => {
    const transporter = nodemailer.createTransport({
        service: mailConfig.service,
        auth: {
          user: mailConfig.username,
          pass: mailConfig.password
        }
      });

      let mailTo = mailConfig.emContact;
      const emailHTML = "<p> Reviewer " + (req.body.reviewerName ? req.body.reviwerName : 'missing') +
                        ' with provider ' + (req.body.provider ? req.body.provider : 'missing') + ' ' +
                        alert + ' for trip # ' + (req.body.tripNum ? req.body.tripNum : 'missing') +
                        '.</p>';

    try {
        let mailOptions = {
            from: mailConfig.sender,
            to: mailTo,
            subject: alert,
            html: emailHTML
        };

        transporter.sendMail(mailOptions, function(error, info) {
            if (error) {
                console.log(error);
            } else {
                console.log('Email sent: ' + info.response);
            }
        });

        } catch (err) {
            console.log(err);
        }
}

const emailCoordinator = async (req, res) => {

    const transporter = nodemailer.createTransport({
        service: mailConfig.service,
        auth: {
          user: mailConfig.username,
          pass: mailConfig.password
        }
      });

      let mailTo = '';
      if (req.body.departurePort.state === 'CA' && req.body.departurePort.code !== 'CRS') {
          mailTo = mailConfig.southCorrdinatorEmail;
      } else {
          mailTo = mailConfig.northCoordinatorEmail;
      }

      if (!req.body.tripNum) {
          res.statsus(400).send('invalid submission');
          return;
      }

    //   let changelogstring = '';
    //   for (const row of req.body.changeLog) {
    //       changelogstring += "<b>" + (row.property + "</b> changed to <b>" + row.newVal + "</b> from <b>" + row.oldVal + "</b><br> ");
    //   }

      const emailHTML =
          "<p>Trip #: <b>" + (req.body.tripNum ? req.body.tripNum : 'missing') + "</b><br>" +
          "Vessel: <b>" + (req.body.vessel ? req.body.vessel.vesselName : 'missing') + " (" + (req.body.vesselId ? req.body.vesselId : 'missing') + ")</b><br>" +
          "Departure Date/Time: <b>" + (req.body.departureDate ? moment(req.body.departureDate).format('MMM Do YYYY, HH:mm') : 'missing') + "</b><br>" +
          "Departure Port: <b>" + (req.body.departurePort ? req.body.departurePort.name : 'missing') + "</b><br>" +
          "Return Date: <b>" + (req.body.returnDate ? moment(req.body.returnDate).format('MMM Do YYYY') : 'missing') + "</b><br>" +
          "Return Port: <b>" + (req.body.returnPort ? req.body.returnPort.name : 'missing') + "</b><br>" +
          "Fishery: <b>" + (req.body.fishery ? req.body.fishery.description : 'missing') + "</b><br>" +
          "Created By: <b>" + (req.body.createdBy ? req.body.createdBy : 'missing') + "</b><br>" +
          "Created Date: <b>" + (req.body.createdDate ? req.body.createdDate : 'missing') + "</b><br>" +
        //   "Notes: <b>" + (req.body.notes ? req.body.notes : 'missing') + "</b><br>" +
        //   "Change Log: <br>" + changelogstring +
          "</p>"

      try {
        let mailOptions = {
            from: mailConfig.sender,
            to: mailTo,
            subject: req.body.emailType + " : " + moment(req.body.departureDate).format('MMM Do YYYY, HH:mm') + ' trip, for vessel: ' + req.body.vessel.vesselName + ', departure port: ' + req.body.departurePort.name +  (['NEW', 'UPDATE'].includes(req.body.emailType) ? 'requires an Observer.' : '.'),
            html: emailHTML
        };

        transporter.sendMail(mailOptions, function(error, info) {
            if (error) {
                console.log(error);
                res.status(400).send(error);
            } else {
                console.log('Email sent: ' + info.response);
                res.status(200).send(info.response);
            }
        });

      } catch (err) {
          console.log(err);
          res.status(400).send(err);
      }

}

const mongoRead = async (req, res) => {
    let response = [];
    let collection = req.params.collection;
    let database = req.params.database;

    response = await mongo.findDocuments(database, collection,
        req.query, req.body.query, req.body.options);

    if (response.length > 0) {
        res.status(200).send(response);
    } else {
        res.status(400).send('no matching results found');
    }

}


const mongoGet = async (req, res) => {
    let response = [];
    let collection = req.params.collection;
    let database = req.params.database;
    let id = req.params.id;

    await mongo.getDocById(database, collection, (document) => {
        response.push(document);
    }, id)

    if (response.length > 0) {
        res.status(200).send(response);
    } else {
        res.status(400).send('no matching results found');
    }
}

const mongoGetMany = async (req, res) => {
    let response = [];
    let collection = req.params.collection;
    let database = req.params.database;
    let ids = req.body.ids;

    await mongo.getDocsById(database, collection, (document) => {
        response.push.apply(response, document);
    }, ids)

    if (response.length > 0) {
        res.status(200).send(response);
    } else {
        res.status(400).send('no matching results found');
    }
}

const mongoGetCollections = async (req, res) => {
    let response = [];
    let database = req.params.database;

    response = await mongo.getCollections(database)

    if (response.length > 0) {
        res.status(200).send(response);
    } else {
        res.status(400).send('no collections found');
    }
}

const aggregatePipeline = async (req, res) => {
    let response = [];
    let collection = req.params.collection;
    let database = req.params.database;
    let pipeline = req.body.pipeline;

    await mongo.aggregate(database, collection, (document) => {
        response.push(document);
    }, pipeline)

    if (response.length > 0) {
        res.status(200).send(response);
    } else {
        res.status(400).send('no matching results found');
    }
}

const mongoWrite = async (req, res) => {
    let database = req.params.database;
    let collection = req.params.collection;
    let response = '';
    let documents = [];

    console.log(req.body);
    if (Array.isArray(req.body)) {
        documents = req.body;
    }

    try {
        await mongo.writeDocuments(database, collection, documents, (result) => {
        console.log(result)
        response = result;
        if (response) {
            res.status(200).send(response);
        } else {
            res.status(400).send('unable to write docs');
        }
    })
    } catch (err) {
        res.status(400).send(err);
    }
}

const mongoUpdate = async (req, res) => {
    let response: any = '';
    let document = {};

    console.log(req.body);
    document = req.body;

    response = await mongo.updateDocument('documents', document);

    if (response) {
        res.status(200).send(response);
    } else {
        res.status(400).send('unable to update document');
    }
}

const mongoDelete = async (req, res) => {
    let response: any = '';
    let document = {};

    console.log(req.body);
    document = req.body;

    response = await mongo.deleteDocument('documents', document);
    console.log(response);

    if (response) {
        res.status(200).send(response);
    } else {
        res.status(400).send('unable to delete document');
    }
}

const handleGetWaiversRequest = async (req: any, res: any) => {
    let result: any = {};
    const docId: string = req.query.id;
    const vesselId: string = req.query.vesselId ? req.query.vesselId : '';
    const year: number = req.query.year ? req.query.year : '';
    const databaseClient: databaseClient = req.query.databaseClient ? req.query.databaseClient : '';

    if (docId) {
        result = await waivers.getById(docId, databaseClient);

    } else {
        result = await waivers.getByIdAndYear(vesselId, year, databaseClient);
    }
    if (result) {
      res.status(200).json(result);
    } else {
      res.status(400).send('query found no matches.');
    }
}

const handleGetSelectionsRequest = async (req: any, res: any ) => {
    const year = req.query.year ? req.query.year : '';
    const selections = await getVesselSelections(year);
    if (selections) {
      res.status(200).json(selections);
    } else {
      res.status(400).send('query found no matches');
    }
}

const handleGetOracleTripsRequest = async (req: any, res: any) => {
    const vesselId = req.query.vesselId ? req.query.vesselId : '';
    const startDate = req.query.startDate ? moment(req.query.startDate).format('DD-MMM-YY') : '';
    const endDate = req.query.endDate ? moment(req.query.endDate).format('DD-MMM-YY') : '';

    try {
      const tripRows = await getOracleTrips(vesselId, startDate, endDate);
      if (tripRows) {
        res.status(200).send(tripRows)
      } else {
        res.status(400).send('query found no matches');
      }
    } catch (connErr) {
      console.error(connErr.message);
      res.status(400).send(connErr.message);
    }
}

const handleGetVesselFishTicketsRequest = async (req: any, res: any) => {
    const vesselId = req.query.vesselId ? req.query.vesselId : '';
    const startDate = req.query.startDate ? moment(req.query.startDate).format('YYYY-MM-DD') : '';
    const endDate = req.query.endDate ? moment(req.query.endDate).format('YYYY-MM-DD') : '';

    try {
      const rows = await getVesselFishTickets(vesselId, startDate, endDate);
      if (rows) {
        res.status(200).json(rows)
      } else {
        res.status(400).send('query found no matches');
      }
    } catch (connErr) {
      console.error(connErr.message);
      res.status(400).send(connErr.message);
    }
  }

const newVesselUser = async (req: any, res: any) => {
    console.log(req.body);
    const vesselId = req.body.vesselId;
    const passcode = req.body.passcode;
    const username = req.body.emailAddress;
    const firstName = req.body.firstName;
    const lastName = req.body.lastName;
    const appName = req.body.appName;
    const appShortName = req.body.appShortName;
    const resetURL = req.body.resetURL;
    const usernamePage = req.body.usernamePage;

    console.log('validating passcode');
    const passcodeValid = await checkPasscode(vesselId, passcode);
    if (passcodeValid) {
        console.log('passcode valid');
        // create user and add captain role
        console.log('creating user');
        request.post({
                url: dbConfig.authServer + 'api/v1/addUser',
                json: true,
                rejectUnauthorized: false,
                body: {username, lastName, firstName, emailAddress: username, comment: 'placeholder comment'}
        }, (err: any, response: any, body: any) => {
            if (!err && response.statusCode === 200) {
                console.log('user created');
                console.log('sending password reset email');
                // send password reset email
                console.log('doing PUT to ' + dbConfig.authServer + 'api/v1/send-email');
                request.put({
                    url: dbConfig.authServer + 'api/v1/send-email',
                    json: true,
                    rejectUnauthorized: false,
                    body: {username, comments: '', appName, appShortName, resetURL, newResetUrl: usernamePage, result: ''}
                }, async (err: any, response: any, body: any) => {
                    console.log('send email response: ')
                    console.log(response)
                    if (!err && response.statusCode === 200) {
                        // create person
                        console.log('creating person doc');
                        const newPerson = {
                            type: 'person',
                            apexUserAdminUserName: username.split('@')[0],
                            createdBy: username.split('@')[0],
                            createdDate: moment().format(),
                            firstName,
                            lastName,
                            workEmail: username
                        }
                        await masterDev.bulk({docs: [newPerson]}).then( async (result) => {
                            console.log(result);
                            // assign vessel to person
                            console.log('getting vesselPermissions doc');
                            let vesselPermissions = await masterDev.view(
                                'obs_web',
                                'all_doc_types',
                                {key: 'vessel-permissions', reduce: false, include_docs: true}
                            )
                            vesselPermissions = vesselPermissions.rows[0].doc;
                            const existingRow = vesselPermissions.vesselAuthorizations.find( (row: any) => { row.vesselIdNum = vesselId} );
                            if (existingRow) {
                                console.log('adding to existing authorizedPeople row');
                                existingRow.authorizedPeople.push(result._id);
                            } else {
                                console.log('adding new authorizedPeople row');
                                vesselPermissions.vesselAuthorizations.push(
                                    {
                                        vesselIdNum: vesselId,
                                        authorizedPeople: [result._id]
                                    }
                                );
                            }
                            const done = await masterDev.bulk({docs: [vesselPermissions]});
                            console.log('updated vesselPermissions doc saved');
                            if (done) {
                                res.status(200).send('Success! Account created + associated with vessel');
                            }
                        })
                    } else {
                        console.error(err);
                        res.status(400).send(err);
                    }
                });
            } else {
                console.error(err);
                res.status(400).send(err);
            }
        });
    } else {
        res.status(400).send('Unable to validate passcode');
    }
}

const API_VERSION = 'v1';

router.get('/em-lookups', getLookups);
router.get('/trips-lookups', getTripsLookups);
router.get('/instructions', getInstructions);
router.get('/program', getProgram);
router.get('/docs', getDocs);

router.use('/api/' + API_VERSION + '/login', getPubKey);
router.post('/api/' + API_VERSION + '/login', login);

router.use('/api/' + API_VERSION + '/trips', getPubKey);
router.use('/api/' + API_VERSION + '/trips', validateJwtRequest);
router.get('/api/' + API_VERSION + '/trips', getTrips);
router.post('/api/' + API_VERSION + '/trips', newTrip);

router.use('/api/' + API_VERSION + '/cruise', getPubKey);
router.use('/api/' + API_VERSION + '/cruise', validateJwtRequest);
router.post('/api/' + API_VERSION + '/cruise', newCruise);

router.use('/api/' + API_VERSION + '/trips/:tripNum', getPubKey);
router.use('/api/' + API_VERSION + '/trips/:tripNum', validateJwtRequest);
router.get('/api/' + API_VERSION + '/trips/:tripNum', getTrip);
router.put('/api/' + API_VERSION + '/trips/:tripNum', updateTrip);

router.use('/api/' + API_VERSION + '/tripCatch/:tripNum', getPubKey);
router.use('/api/' + API_VERSION + '/tripCatch/:tripNum', validateJwtRequest);
router.get('/api/' + API_VERSION + '/tripCatch/:tripNum', getCatch);
router.post('/api/' + API_VERSION + '/tripCatch/:tripNum', newCatch);
router.put('/api/' + API_VERSION + '/tripCatch/:tripNum', updateCatch);

router.use('/api/' + API_VERSION + '/evalCatch/:tripNum', getPubKey);
router.use('/api/' + API_VERSION + '/evalCatch/:tripNum', validateJwtRequest);
router.get('/api/' + API_VERSION + '/evalCatch/:tripNum', evalCatch);

router.use('/api/' + API_VERSION + '/mongo', getPubKey);
router.use('/api/' + API_VERSION + '/mongo', validateJwtRequest);
router.post('/api/' + API_VERSION + '/mongo/:database/:collection', mongoRead);
router.get('/api/' + API_VERSION + '/mongo/get/:database/:collection/:id', mongoGet);
router.get('/api/' + API_VERSION + '/mongo/getCollections/:database', mongoGetCollections);
router.post('/api/' + API_VERSION + '/mongo/getMany/:database/:collection/', mongoGetMany);
router.post('/api/' + API_VERSION + '/mongo/aggregate/:database/:collection/', aggregatePipeline);
router.post('/api/' + API_VERSION + '/mongo/write/:database/:collection', mongoWrite);
router.put('/api/' + API_VERSION + '/mongo', mongoUpdate);
router.delete('/api/' + API_VERSION + '/mongo', mongoDelete);

router.use('/api/' + API_VERSION + '/screenshot/:tripNum', getPubKey);
router.use('/api/' + API_VERSION + '/screenshot/:tripNum', validateJwtRequest);
router.post('/api/' + API_VERSION + '/screenshot/:tripNum', saveScreenshot);

router.use('/api/' + API_VERSION + '/email', getPubKey);
router.use('/api/' + API_VERSION + '/email', validateJwtRequest);
router.post('/api/' + API_VERSION + '/email', emailCoordinator);

router.get('/api/' + API_VERSION + '/updateBuyers', updateBuyers);
router.get('/api/' + API_VERSION + '/runRolloverCheck', rolloverCheck);
// router.get('/api/' + API_VERSION + '/insertRow', insertObsprodRow);

router.use('/api/' + API_VERSION + '/runTripChecks', getPubKey);
router.use('/api/' + API_VERSION + '/runTripChecks', validateJwtRequest);
router.post('/api/' + API_VERSION + '/runTripChecks', runTripErrorChecks);

router.use('/api/' + API_VERSION + '/getSelections', getPubKey);
router.use('/api/' + API_VERSION + '/getSelections', validateJwtRequest);
router.get('/api/' + API_VERSION + '/getSelections', handleGetSelectionsRequest);

router.use('/api/' + API_VERSION + '/getWaivers', getPubKey);
router.use('/api/' + API_VERSION + '/getWaivers', validateJwtRequest);
router.get('/api/' + API_VERSION + '/getWaivers', handleGetWaiversRequest);

router.use('/api/' + API_VERSION + '/getFishTicket', getPubKey);
router.use('/api/' + API_VERSION + '/getFishTicket', validateJwtRequest);
router.get('/api/' + API_VERSION + '/getFishTicket', fishTicketQuery);

router.use('/api/' + API_VERSION + '/getVesselFishTickets', getPubKey);
router.use('/api/' + API_VERSION + '/getVesselFishTickets', validateJwtRequest);
router.get('/api/' + API_VERSION + '/getVesselFishTickets', handleGetVesselFishTicketsRequest);

router.use('/api/' + API_VERSION + '/getOracleTrips', getPubKey);
router.use('/api/' + API_VERSION + '/getOracleTrips', validateJwtRequest);
router.get('/api/' + API_VERSION + '/getOracleTrips', handleGetOracleTripsRequest);

router.get('/api/' + API_VERSION + '/vms/test', vmsDBTest);
router.post('/api/' + API_VERSION + '/newVesselUser', newVesselUser);

router.use('/api/' + API_VERSION + '/vms/getDeclarations', getPubKey);
router.use('/api/' + API_VERSION + '/vms/getDeclarations', validateJwtRequest);
router.get('/api/' + API_VERSION + '/vms/getDeclarations', getRecentDeclarations);

module.exports = router;
