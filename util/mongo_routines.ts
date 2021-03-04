const { MongoClient } = require('mongodb');

const mongoUri = require('../dbConfig.json').mongoUri;
const mongoDbName = 'common';

const assert = require('assert');

export async function findDocuments(collectionName, callback, query?) {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect()
        const db = mongoClient.db(mongoDbName)

        const collection = db.collection(collectionName);

        await collection.find(query).toArray(function(err, docs) {
            callback(docs)
        });
        await mongoClient.close();
    } catch(err) {
        console.error(err);
    }
}

export async function writeDocuments(collectionName, documents, callback) {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect()
        const db = mongoClient.db(mongoDbName)

        const collection = db.collection(collectionName);
        // Insert some documents
        await collection.insertMany(documents, function(err, result) {
          assert.equal(err, null);
          console.log("Inserted document into the collection");
          callback(result);
        });
        await mongoClient.close();
    } catch(err) {
        console.error(err);
    }
}
