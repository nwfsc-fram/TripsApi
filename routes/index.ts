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
    console.log(username, password);

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
        console.log(body)
        token = body.token;

        request.get({
            url: dbConfig.authServer + 'api/v1/pubkey',
            rejectUnauthorized: false,
            requestCert: false,
            agent: false,
        }, function (err, response, body) {
            key = pemjwk.jwk2pem(JSON.parse(body).keys[0])

            res.send({
                "token": token
            })

        })

    })

}

const getTrips = (req, res) => {
    console.log(req.query);
    masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "descending": true, include_docs: true}).then((body) => {
        if (body.rows) {
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

const newTrip = (req, res) => {
    if (req.body.vesselId) {
        masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "descending": true, "limit": 1}).then((body) => {
            const maxId = body.rows[0].key
            const newTrip = req.body
            newTrip.tripId = maxId + 1
            masterDev.bulk({docs: [newTrip]}).then(
                setTimeout(() => {
                    masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": maxId + 1}).then((result) => {
                        res.send(result)
                    })
                }, 500)
            )
          });
    } else {
        res.status(500).send('vesselID is required to create a new trip.')
    }
}

const getTrip = (req, res) => {
    masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": parseInt(req.params.tripId), "include_docs": true}).then((body) => {
        if ( body.rows[0].doc ) {
            res.json(body.rows[0].doc);
        } else {
            res.send('Doc with specified tripId not found')
        }
    })
}

const updateTrip = async (req, res) => {
    const existing = await masterDev.get(req.body._id)
    console.log(existing)
    if (existing.tripId === req.body.tripId ) {
        masterDev.bulk({docs: [req.body]}).then( (body) => {
            res.json(body);
        })
    } else {
        res.status(500).send('Trip ID can not be changed.')
    }
}

const API_VERSION = 'v1';
router.post('/api/' + API_VERSION + '/login', login);
router.use('/api/' + API_VERSION + '/trips', validateJwtRequest);
router.get('/api/' + API_VERSION + '/trips', getTrips);
router.post('/api/' + API_VERSION + '/trips', newTrip);
router.use('/api/' + API_VERSION + '/trips/:tripId', validateJwtRequest);
router.get('/api/' + API_VERSION + '/trips/:tripId', getTrip);
router.put('/api/' + API_VERSION + '/trips/:tripId', updateTrip);

module.exports = router;