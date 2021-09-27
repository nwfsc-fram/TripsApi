const { MongoClient } = require('mongodb');

export class MongoHelper {
    static client: any;

    constructor() {
    }

    static async connect() {
        const mongoUri = require('../dbConfig.json').mongoUri;
        MongoHelper.client = new MongoClient(mongoUri);
        await MongoHelper.client.connect();
    }

    async disconnect() {
        await MongoHelper.client.close();
    }
}