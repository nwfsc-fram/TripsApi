const dbConfig = require('../dbConfig.json').dbConfig;
const express = require('express');
const router = express.Router()

const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev')

const getTrips = (req, res) => {
    console.log(req.query);
    masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "descending": true}).then((body) => {
        res.json(body)
      });
    // res.json(['trip 1', 'trip 2', 'trip 3']);
}

const newTrip = (req, res) => {
    // get next tripId
    masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "descending": true, "limit": 1}).then((body) => {
        const maxId = body.rows[0].key
        // apply tripId to req.body
        const newTrip = req.body
        newTrip.tripId = maxId + 1
        console.log(newTrip)
        // insert into db
        masterDev.insert(newTrip).then(
            setTimeout(() => {

                masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": maxId + 1}).then((result) => {
                    res.send(result)
                })
            }, 500)
        )
      });
}

const getTrip = (req, res) => {
    console.log(req.params);
    masterDev.view('TripsApi', 'all_api_trips', {"reduce": false, "key": parseInt(req.params.tripId), "include_docs": true}).then((body) => {
        res.json(body.rows[0].doc);
    })
}

const updateTrip = (req, res) => {
    console.log(req.params);
    console.log(req.body);
    res.json('updated trip');
}

const API_VERSION = 'v1';
router.get('/api/' + API_VERSION + '/trips', getTrips)
router.post('/api/' + API_VERSION + '/trips', newTrip)
router.get('/api/' + API_VERSION + '/trips/:tripId', getTrip)
router.put('/api/' + API_VERSION + '/trips/:tripId', updateTrip)

module.exports = router;