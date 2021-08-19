const { MongoClient } = require('mongodb');
import { cloneDeep } from 'lodash';
const ObjectId = require('mongodb').ObjectID;

const mongoUri = require('../dbConfig.json').mongoUri;
const mongoDbName = 'lookupsdb';

export async function findDocuments(database, collectionName, callback, query?, bodyQuery?, bodyOptions?) {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect()
        const db = mongoClient.db(database)

        const collection = db.collection(collectionName);

        if (!bodyOptions) {
            bodyOptions = {};
        }
        if (bodyQuery) {
            await collection.find(bodyQuery, bodyOptions).toArray(function(err, docs) {
                callback(docs)
            });
            await mongoClient.close();
        } else {
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
        }
    } catch(err) {
        console.error(err);
    }
}

export async function aggregate(database, collectionName, callback, pipeline) {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect()
        const db = mongoClient.db(database)

        const collection = db.collection(collectionName);

        await collection.aggregate(pipeline).toArray(function(err, docs) {
            callback(docs)
        });
        await mongoClient.close();
    } catch(err) {
        console.error(err);
    }
}

export async function getDocById(database, collectionName, callback, id) {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect()
        const db = mongoClient.db(database)

        const collection = db.collection(collectionName);
        const queryId = new ObjectId(id)
        const docs = await collection.findOne({_id: queryId});
        callback(docs);
        await mongoClient.close();

    } catch(err) {
        console.error(err);
    }
}

export async function getDocsById(database, collectionName, callback, ids) {
    try {
        const mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect()
        const db = mongoClient.db(database)

        const collection = db.collection(collectionName);
        let queryIds = [];
        for (const id of ids) {
            const queryId = new ObjectId(id);
            queryIds.push({_id: queryId});
        }
        await collection.find({"$or": queryIds }).toArray(function(err, docs) {
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
