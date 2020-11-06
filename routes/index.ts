const express = require('express');
const router = express.Router();

const utils = require('../security.utils.ts');
const axios = require('axios');
const request = require('request');

const nodemailer = require('nodemailer');
const mailConfig = require('../dbConfig.json').mailConfig;

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
import { getFishTicket, fakeDBTest } from '../util/oracle_routines';
import { catchEvaluator } from '../util/trip-functions';
import { Catches, sourceType } from '@boatnet/bn-models';
import { set } from 'lodash';
import { masterDev, dbConfig } from '../util/couchDB';

import { stringParser } from '../util/string-parser';
import { validateCatch } from '../util/validator';

let token = '';
export let key = '';
const jp = require('jsonpath');

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
    await masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "descending": true, include_docs: true}).then((body) => {
        if ( body.rows.length > 0 ) {
            const docs = body.rows.map((row) => row.doc)
            switch(Object.keys(req.query)[0]) {
                case 'vesselId':
                  res.json(docs.filter( (doc) => doc.vesselId === req.query.vesselId ))
                  break;
                case 'captain':
                    res.json(docs.filter( (doc) => doc.captain.toLowerCase() === req.query.captain.toLowerCase() ))
                    break;
                case 'port':
                    res.json(docs.filter( (doc) => doc.departurePort.toLowerCase() === req.query.port.toLowerCase() || doc.returnPort.toLowerCase() === req.query.port.toLowerCase() ))
                    break;
                case 'fishery':
                    res.json(docs.filter( (doc) => doc.fishery && doc.fishery.toLowerCase() === req.query.fishery.toLowerCase() ))
                    break;
                default:
                    res.json(docs)
              }
        } else {
            res.status(400).send('not found')
        }
      });
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
    if (req.body.vesselId) {
        await masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "descending": true, "limit": 1}).then((body) => {
            const maxId = body.rows[0].key
            const newTrip = req.body
            newTrip.type = 'trips-api'
            newTrip.tripNum = maxId + 1
            masterDev.bulk({docs: [newTrip]}).then(
                setTimeout(() => {
                    masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": maxId + 1, "include_docs": true}).then((result) => {

                        res.send(
                            {
                                tripNum: maxId + 1,
                                trip: result.rows[0].doc
                            }
                        )
                    })
                }, 500)
            )
            });
    } else {
        res.status(400).send('vesselID is required to create a new trip.')
    }
}

const getTrip = async (req, res) => {
    const tripNum = parseInt(req.params.tripNum, 10)
    await masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": tripNum, "include_docs": true}).then((body) => {
        if ( body.rows.length > 0 ) {
            res.json(body.rows[0].doc);
        } else {
            res.send('Doc with tripNum: ' + tripNum + ' not found')
        }
    })
}

const updateTrip = async (req, res) => {
    if (req.headers['content-type'] == "application/xml") { stringParser(req); }
    const existing = await masterDev.get(req.body._id);
    if (existing.tripNum === parseInt(req.params.tripNum, 10) ) {
        masterDev.bulk({docs: [req.body]}).then( (body) => {
            res.json(body);
        })
    } else {
        res.status(400).send('Trip ID:' + req.body._id + ' not found.')
    }
}

const getCatch = async (req, res) => {
    masterDev.view('TripsApi', 'all_api_catch', {"reduce": false, "key": parseInt(req.params.tripNum, 10), "include_docs": true}).then((body) => {
        if ( body.rows.length > 0) {
            const docs = body.rows.map((row) => row.doc)
            res.json(docs)
        } else {
            res.status(400).send('not found')
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
            newTrip.revision = 0;

            // check trip doc for tripNum exists
            const tripDocs = await masterDev.view('TripsApi', 'all_api_trips', { "key": tripNum });
            if (tripDocs.rows.length === 0 ) {
                res.status(400).send('Trip doc with tripNum: ' + tripNum + ' does not exist. ' +
                    'Please create a valid tripDoc before submitting catchDoc.');
                return;
            }

            const catchDocs = await masterDev.view('TripsApi', 'all_api_catch', { "key": tripNum, "include_docs": true });
            const source: string[] = jp.query(catchDocs, '$..source');

            if (source.includes(req.body.source)) {
                res.status(400).send('Catch doc with tripNum:' + tripNum + ' already exists. ' +
                    'Please submit updated data via PUT to /tripCatch/:tripNum');
                return;
            } else {
                if ([sourceType.thirdParty, sourceType.nwfscAudit, sourceType.logbook].includes(req.body.source)) {

                    // additional validation checks
                    const validationResults = await validateCatch(newTrip);
                    if (validationResults.status != 200) {
                        res.status(validationResults.status).send(validationResults.message);
                        return;
                    }
                    const errors: string = validationResults.catchVal.errors && validationResults.catchVal.errors.length > 0 ? ' Errors: ' + JSON.stringify(validationResults.catchVal.errors) : '';

                    // everything is good, write to db and evaluate catch doc
                    masterDev.bulk({ docs: [validationResults.catchVal] }).then(
                        () => {
                            catchEvaluator(tripNum);
                            res.status('200').send('Catch doc with tripNum:' + tripNum + ' saved successfully. ' + errors);
                            return;
                    });

                } else {
                    res.status(400).send('Invalid source: ' + req.body.source + '. Accepted source values are:' +
                        'thirdParty, nwfscAudit, and logbook. Please correct source and resubmit.')
                        return;
                }
            }

        } else {
            res.status(400).send('missing required parameters.');
            return;
        }
    }, 300)
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

    // get catchDocs with same source type as one specified in the request
    const catchDoc = catchDocs.rows.filter((row) => row.doc.source === req.body.source);
    if (!catchDoc) {
        res.status(400).send('Catch doc with tripNum: ' + tripNum + ' and source: ' + req.body.source +
            ' does not exist please submit new catch via POST to /tripCatch/:tripNum');
        return;
    }

    const couchDoc = catchDoc[0].doc;
    const updateDoc: any = req.body;

    // additional validation checks
    const validationResults = await validateCatch(updateDoc);
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
    if (!reqDoc.history) {
        set(reqDoc, 'history', []);
    }
    reqDoc.history.unshift(couchDoc);
    const errors: string = reqDoc.errors && reqDoc.errors.length > 0 ? ' Errors: ' + JSON.stringify(reqDoc.errors) : '';
    masterDev.bulk({ docs: [reqDoc] }).then((body) => {
        catchEvaluator(tripNum);
        res.status(200).send('Catch doc with tripNum:' + tripNum + ' successfully updated!' + errors);
    })
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
        'fishery-sector': 'fisherySector',
        'gear-type': 'gearTypeCode',
        'catch-handling-performance': 'catchHandlingPerformance',
        'system-performance': 'systemPerformance',
        'review-species': 'speciesCode (review)',
        'logbook-species': 'speciesCode (logbook)'
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
    }
    const csv = await jsonexport(formatted);

    res.render('lookups', {lookupResults, csv});
}

const getInstructions = async (req, res) => {
    const exampleLogbook = await masterDev.view('TripsApi', 'all_api_catch', {include_docs: true, reduce: false, key: 100001})
    res.render('instructions-main', {path: path.resolve(__dirname.replace('\\routes', '')), exampleLogbook: exampleLogbook.rows[0].doc});
};

const getProgram = async (req, res) => {
    res.render('program');
};

const getDocs = async (req, res ) => {
    res.render('docs');
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

      let changelogstring = '';
      for (const row of req.body.changeLog) {
          changelogstring += "<b>" + (row.property + "</b> changed to <b>" + row.newVal + "</b> from <b>" + row.oldVal + "</b><br> ");
      }

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
          "Notes: <b>" + (req.body.notes ? req.body.notes : 'missing') + "</b><br>" +
          "Change Log: <br>" + changelogstring +
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

const API_VERSION = 'v1';

router.get('/lookups', getLookups);
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

router.use('/api/' + API_VERSION + '/screenshot/:tripNum', getPubKey);
router.use('/api/' + API_VERSION + '/screenshot/:tripNum', validateJwtRequest);
router.post('/api/' + API_VERSION + '/screenshot/:tripNum', saveScreenshot);

router.use('/api/' + API_VERSION + '/email', getPubKey);
router.use('/api/' + API_VERSION + '/email', validateJwtRequest);
router.post('/api/' + API_VERSION + '/email', emailCoordinator);

router.get('/api/' + API_VERSION + '/vmstest', fakeDBTest);

module.exports = router;