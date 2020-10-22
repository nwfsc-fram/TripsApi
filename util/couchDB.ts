export const dbConfig = require('../dbConfig.json').dbConfig;
const couchDB = require('nano')(dbConfig.login);
export const masterDev = couchDB.db.use('master-dev');