const { MongoClient } = require('mongodb');
import { cloneDeep } from 'lodash';

const mongoUri = require('../dbConfig.json').mongoUri;
const mongoDbName = 'common';

export async function findDocuments(collectionName, callback, query?) {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect()
        const db = mongoClient.db(mongoDbName)

        const collection = db.collection(collectionName);

        let formattedQuery = cloneDeep(query);
        for (const queryKey of Object.keys(formattedQuery) ) {
            if (formattedQuery[queryKey] === 'true') {
                formattedQuery[queryKey] = true;
            }
            if (parseInt(formattedQuery[queryKey], 10)) {
                formattedQuery[queryKey] = parseInt(formattedQuery[queryKey], 10);
            }
        }

        await collection.find(formattedQuery).toArray(function(err, docs) {
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
          console.log("Inserted document into the collection");
          callback(result);
        });
        await mongoClient.close();
    } catch(err) {
        console.error(err);
    }
}

export async function updateDocument(collectionName, document) {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect()
        const db = mongoClient.db(mongoDbName)

        const collection = db.collection(collectionName);
        const result = await collection.findOneAndUpdate(
            {_id: document._id},
            {
                $set: document
            },
            {
                upsert: true
            }
        )
        await mongoClient.close();
        return result;
    } catch(err) {
        console.error(err);
    }
}

export async function deleteDocument(collectionName, document) {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect()
        const db = mongoClient.db(mongoDbName)

        const collection = db.collection(collectionName);
        const result = await collection.deleteOne(
            {_id: document._id}
        )
        await mongoClient.close();
        return result;
    } catch(err) {
        console.error(err);
    }
}
