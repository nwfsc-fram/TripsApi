import * as moment from 'moment';
const dbConfig = require('./dbConfig.json').dbConfig;

import * as jwt from 'jsonwebtoken';
const request = require('request');
import { key } from './routes/index';
import * as pemjwk from 'pem-jwk';

// from https://stackoverflow.com/questions/23097928/node-js-btoa-is-not-defined-error
// Encode/decode base64 (not encryption functions)
const btoaUTF8 = function(str) { return Buffer.from(str, 'utf8').toString('base64'); }
const atobUTF8 = function(b64Encoded) {return Buffer.from(b64Encoded, 'base64').toString('utf8');}

function decode64(encValue) {
    return atobUTF8(encValue);
}

function encode64(value) {
    return btoaUTF8(value);
}

export async function decodeJwt(token) {

    console.log(key)
    const payload = await jwt.verify(token, key);

    // JWT Decode here.
    // console.log('Middleware: JWT payload is still valid.')
    // console.log('decoded JWT payload', payload);

    return payload;
}

