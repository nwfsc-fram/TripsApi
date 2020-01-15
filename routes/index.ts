const dbConfig = require('../dbConfig.json').dbConfig;
const express = require('express');
const router = express.Router();

const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev');

const utils = require('../security.utils.ts');
const axios = require('axios');
const request = require('request');

const https = require('https');

import * as pemjwk from 'pem-jwk';
import { Request, Response, NextFunction } from 'express';

const DEFAULT_APPLICATION_NAME = 'BOATNET_OBSERVER';

import { validateJwtRequest } from '../get-user.middleware';

let token = '';
export let key = '';

const login = (req, res) => {

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

    request.post({
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
                    res.json(docs.filter( (doc) => doc.fisheries && doc.fisheries.map( (fishery) => fishery.toLowerCase() ).includes(req.query.fishery) ))
                    break;
                default:
                    res.json(docs)
              }
        } else {
            res.status(400).send('not found')
        }
      });
}

const newTrip = async (req, res) => {
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
    masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": parseInt(req.params.tripNum), "include_docs": true}).then((body) => {
        console.log(body);
        if ( body.rows.length > 0 ) {
            res.json(body.rows[0].doc);
        } else {
            res.send('Doc with specified tripNum not found')
        }
    })
}

const updateTrip = async (req, res) => {
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
    masterDev.view('TripsApi', 'all_api_catch', {"reduce": false, "key": req.params.tripNum, "include_docs": true}).then((body) => {
        if ( body.rows.length > 0) {
            const docs = body.rows.map((row) => row.doc)
            res.json(docs)
        } else {
            res.status(400).send('not found')
        }
    })
}

const newCatch = async (req, res) => {
    if (req.params.tripNum && req.body.tripNum && req.body.source && req.body.hauls) {
            const newTrip = req.body
            newTrip.type = 'trips-api-catch'
            masterDev.bulk({docs: [newTrip]}).then(
                res.send('catch data saved')
            );
    } else {
        res.status(500).send('missing required parameters.')
    }
}

const updateCatch = async (req, res) => {
    if (req.body._id) {
        try {
            const existing = await masterDev.get(req.body._id)
            if (existing.tripNum === req.body.tripNum ) {
                masterDev.bulk({docs: [req.body]}).then( (body) => {
                    res.status('200').send('catch data updated');
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

const API_VERSION = 'v1';
router.use('/api/' + API_VERSION + '/login', getPubKey);
router.post('/api/' + API_VERSION + '/login', login);
router.use('/api/' + API_VERSION + '/trips', getPubKey);
router.use('/api/' + API_VERSION + '/trips', validateJwtRequest);
router.get('/api/' + API_VERSION + '/trips', getTrips);
router.post('/api/' + API_VERSION + '/trips', newTrip);
router.use('/api/' + API_VERSION + '/trips/:tripNum', getPubKey);
router.use('/api/' + API_VERSION + '/trips/:tripNum', validateJwtRequest);
router.get('/api/' + API_VERSION + '/trips/:tripNum', getTrip);
router.put('/api/' + API_VERSION + '/trips/:tripNum', updateTrip);
router.use('/api/' + API_VERSION + '/tripCatch/:tripNum', getPubKey);
router.use('/api/' + API_VERSION + '/tripCatch/:tripNum', validateJwtRequest);
router.get('/api/' + API_VERSION + '/tripCatch/:tripNum', getCatch);
router.post('/api/' + API_VERSION + '/tripCatch/:tripNum', newCatch);
router.put('/api/' + API_VERSION + '/tripCatch/:tripNum', updateCatch);


module.exports = router;