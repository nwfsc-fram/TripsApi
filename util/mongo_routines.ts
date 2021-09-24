import { cloneDeep } from 'lodash';
import { MongoHelper } from './mongoClient';
const ObjectId = require('mongodb').ObjectID;

const mongoUri = require('../dbConfig.json').mongoUri;
const mongoDbName = 'lookupsdb';

MongoHelper.connect();

export async function findDocuments(database, collectionName, callback, query?, bodyQuery?, bodyOptions?) {
    try {
        const db = MongoHelper.client.db(mongoDbName);
        const collection = db.collection(collectionName);

        if (!bodyOptions) {
            bodyOptions = {};
        }
        if (bodyQuery) {
            console.log("body query: " + bodyQuery)
            await collection.find(bodyQuery, bodyOptions).toArray(function(err, docs) {
                callback(docs)
            });
        } else {
            let formattedQuery = cloneDeep(query);
            for (const queryKey of Object.keys(formattedQuery) ) {
                if (formattedQuery[queryKey] === 'true') {
                    formattedQuery[queryKey] = true;
                }
                if (typeof formattedQuery[queryKey] === 'number') {
                    formattedQuery[queryKey] = parseInt(formattedQuery[queryKey], 10);
                }
            }

            await collection.find(formattedQuery).toArray(function(err, docs) {
                callback(docs)
            });
        }
    } catch(err) {
        console.error(err);
    }
}

export async function aggregate(database, collectionName, callback, pipeline) {
    try {
        const db = MongoHelper.client.db(database);
        const collection = db.collection(collectionName);

        await collection.aggregate(pipeline).toArray(function(err, docs) {
            callback(docs)
        });
    } catch(err) {
        console.error(err);
    }
}

export async function getDocById(database, collectionName, callback, id) {
    try {
        const db = MongoHelper.client.db(database);
        const collection = db.collection(collectionName);

        const queryId = new ObjectId(id)
        const docs = await collection.findOne({_id: queryId});
        callback(docs);

    } catch(err) {
        console.error(err);
    }
}

export async function getDocsById(database, collectionName, callback, ids) {
    try {
        const db = MongoHelper.client.db(database);
        const collection = db.collection(collectionName);

        let queryIds = [];
        for (const id of ids) {
            const queryId = new ObjectId(id);
            queryIds.push({_id: queryId});
        }
        await collection.find({"$or": queryIds }).toArray(function(err, docs) {
            callback(docs)
        });

    } catch(err) {
        console.error(err);
    }
}

export async function writeDocuments(collectionName, documents, callback) {
    try {
        const db = MongoHelper.client.db(mongoDbName);
        const collection = db.collection(collectionName);

        // Insert some documents
        await collection.insertMany(documents, function(err, result) {
          console.log("Inserted document into the collection");
          callback(result);
        });
    } catch(err) {
        console.error(err);
    }
}

export async function updateDocument(collectionName, document) {
    try {
        const db = MongoHelper.client.db(mongoDbName);
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
        return result;
    } catch(err) {
        console.error(err);
    }
}

export async function deleteDocument(collectionName, document) {
    try {
        const db = MongoHelper.client.db(mongoDbName);
        const collection = db.collection(collectionName);

        const result = await collection.deleteOne(
            {_id: document._id}
        )
        return result;
    } catch(err) {
        console.error(err);
    }
}
