const dbConfig = require('../dbConfig.json').dbConfig;

const express = require('express');
const router = express.Router();

const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev');

const utils = require('../security.utils.ts');
const axios = require('axios');
const request = require('request');

const nodemailer = require('nodemailer');
const mailConfig = require('../dbConfig.json').mailConfig;

const https = require('https');

const parseString = require('xml2js').parseString;

import * as pemjwk from 'pem-jwk';
import { Request, Response, NextFunction } from 'express';

const DEFAULT_APPLICATION_NAME = 'BOATNET_OBSERVER';

const moment = require('moment');

import { validateJwtRequest } from '../get-user.middleware';
import { getFishTicket } from '../oracle_routines';
import { catchEvaluator } from '../trip-functions';
import { runInNewContext } from 'vm';

let token = '';
export let key = '';

const stringParser = function(req) {
    parseString(req.rawBody, {explicitArray: false}, function(err, result) {
        req.body = JSON.parse(JSON.stringify(result.root));
        if (req.body.permits && typeof req.body.permits === 'string') { req.body.permits = [req.body.permits] }
        if (req.body.fisheries && typeof req.body.fisheries === 'string') { req.body.fisheries = [req.body.fisheries] }
        if (req.body.buyers && typeof req.body.buyers === 'string') { req.body.buyers = [req.body.buyers] }
        if (req.body.fishTickets) {
            for (const fishTicket of req.body.fishTickets) {
                fishTicket.fishTicketNumber = [fishTicket.fishTicketNumber]
                fishTicket.fishTicketDate = [fishTicket.fishTicketDate]
            }
        }

        for (const attrib of Object.keys(req.body)) {
            if (!['gearTypeDescription', 'comments', 'targetStrategy', 'fishTickets'].includes(attrib) && attrib !== 'departureDateTime' && attrib !== 'returnDateTime' && parseFloat(req.body[attrib])) { req.body[attrib] = parseFloat(req.body[attrib]) }
            if (req.body[attrib] == 'true') { req.body[attrib] = true; }
            if (req.body[attrib] == 'false') { req.body[attrib] = false; }
            if (attrib == 'hauls') {
                for (const haul of req.body[attrib]) {
                    for (const haulAttrib of Object.keys(haul)) {
                        if (!['gearTypeDescription', 'comments', 'targetStrategy', 'catch'].includes(haulAttrib) && haulAttrib !== 'startDateTime' && haulAttrib !== 'endDateTime' && typeof parseFloat(haul[haulAttrib]) == 'number') { haul[haulAttrib] = parseFloat(haul[haulAttrib]) }
                        if (haul[haulAttrib] == 'true') { haul[haulAttrib] = true; }
                        if (haul[haulAttrib] == 'false') { haul[haulAttrib] = false; }
                        if (haulAttrib == 'catch') {
                            for (const catchItem of haul[haulAttrib]) {
                                for (const catchAttrib of Object.keys(catchItem)) {
                                    if (typeof parseFloat(catchItem[catchAttrib]) == 'number' && !['catchId', 'catchDisposition', 'speciesCode', 'calcWeightType', 'comments'].includes(catchAttrib)) { catchItem[catchAttrib] = parseFloat(catchItem[catchAttrib]) }
                                    else if (catchItem[catchAttrib] == 'true') { catchItem[catchAttrib] = true; }
                                    else if (catchItem[catchAttrib] == 'false') { catchItem[catchAttrib] = false; }
                                    else { catchItem[catchAttrib] = catchItem[catchAttrib]}
                                }
                            }
                        }
                    }
                }
            }
        }
        return req;
    })
};

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
        token = body.token;

        res.send({
            "token": token
        })

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
        res.status(500).send('vesselID is required to create a new trip.')
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
        res.status(500).send('vesselID is required to create a new trip.')
    }
}

const getTrip = async (req, res) => {
    await masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": parseInt(req.params.tripNum, 10), "include_docs": true}).then((body) => {
        if ( body.rows.length > 0 ) {
            res.json(body.rows[0].doc);
        } else {
            res.send('Doc with specified tripNum not found')
        }
    })
}

const updateTrip = async (req, res) => {
    if (req.headers['content-type'] == "application/xml") { stringParser(req); }
    const existing = await masterDev.get(req.body._id)
    if (existing.tripNum === req.body.tripNum ) {
        masterDev.bulk({docs: [req.body]}).then( (body) => {
            res.json(body);
        })
    } else {
        res.status(500).send('Trip ID can not be changed.')
    }
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
    setTimeout( () => {
        if (req.params.tripNum && req.body.tripNum && req.body.source && req.body.hauls) {
                const newTrip = req.body;
                newTrip.type = 'trips-api-catch';
                newTrip.createdDate = moment().format();
                masterDev.bulk({docs: [newTrip]}).then(
                    () => {
                        res.send('catch data saved');
                        // catchEvaluator(req.params.tripNum);
                    }
                );
        } else {
            res.status(500).send('missing required parameters.')
        }
    }, 300)
}

const updateCatch = async (req, res) => {
    if (req.headers['content-type'] == "application/xml") { stringParser(req); }
    if (req.body._id && req.body._rev) {
        try {
            const existing = await masterDev.get(req.body._id)
            if (existing.tripNum === req.body.tripNum ) {
                const updateDoc: any = req.body;
                updateDoc.updateDate = moment().format();
                masterDev.bulk({docs: [updateDoc]}).then( (body) => {
                    res.status('200').send('catch data updated');
                    // catchEvaluator(req.params.tripNum);
                })
            } else {
                res.status(500).send('Trip ID can not be changed.')
            }
        } catch (err) {
            res.status(500).send(err)
        }

    } else {
        res.status(500).send('invalid doc - must include _id and _rev')
    }
}

// catchEvaluator('100169');

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
            subject: req.body.emailType + " : " + moment(req.body.departureDate).format('MMM Do YYYY, HH:mm') + ' trip, for vessel: ' + req.body.vessel.vesselName + ', departure port: ' + req.body.departurePort.name +  ' requires an Observer.',
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

router.use('/api/' + API_VERSION + '/email', getPubKey);
router.use('/api/' + API_VERSION + '/email', validateJwtRequest);
router.post('/api/' + API_VERSION + '/email', emailCoordinator);

module.exports = router;