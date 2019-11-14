const dbConfig = require('../dbConfig.json').dbConfig;
const express = require('express');
const router = express.Router()

const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev')

const getTrips = (req, res) => {
    console.log(req.query);
    masterDev.view('LookupDocs', 'beaufort-lookup').then((body) => {
        res.json(body)
      });
    // res.json(['trip 1', 'trip 2', 'trip 3']);
}

const newTrip = (req, res) => {
    // get next tripId
    // apply tripId to req.body
    // insert into db
    // return success message + doc with _id + _rev
    console.log(req.body);
    res.json(req.body);
}

const getTrip = (req, res) => {
    console.log(req.params);
    res.json('trip 3');
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