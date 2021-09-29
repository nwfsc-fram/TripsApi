const { MongoClient } = require('mongodb');
const mongoUri = require('../dbConfig.json').mongoUri;
import { cloneDeep } from 'lodash';
const ObjectId = require('mongodb').ObjectID;
const mongoDbName = 'lookupsdb';

class MongoHelper {
    client: any;

    constructor() {
    }

    async connect() {
        const mongoUri = require('../dbConfig.json').mongoUri;
        this.client = new MongoClient(mongoUri);
        await this.client.connect();
    }

    async findDocuments(database, collectionName, query?, bodyQuery?, bodyOptions?) {
        try {
            const db = this.client.db(database)
            const collection = db.collection(collectionName);
    
            if (!bodyOptions) {
                bodyOptions = {};
            }
            if (bodyQuery) {
                return await collection.find(bodyQuery, bodyOptions).toArray();
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
                return await collection.find(formattedQuery).toArray();
            }
        } catch(err) {
            console.error(err);
        }
    }

    async aggregate(database, collectionName, callback, pipeline) {
        try {
            const db = this.client.db(database);
            const collection = db.collection(collectionName);
    
            await collection.aggregate(pipeline).toArray(function(err, docs) {
                callback(docs)
            });
        } catch(err) {
            console.error(err);
        }
    }

    async getDocById(database, collectionName, callback, id) {
        try {
            const db = this.client.db(database);
            const collection = db.collection(collectionName);
    
            const queryId = new ObjectId(id)
            const docs = await collection.findOne({_id: queryId});
            await callback(docs);
    
        } catch(err) {
            console.error(err);
        }
    }

    async getDocsById(database, collectionName, callback, ids) {
        try {
            const db = this.client.db(database);
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
    
    async writeDocuments(collectionName, documents, callback) {
        try {
            const db = this.client.db(mongoDbName);
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
    
    async updateDocument(collectionName, document) {
        try {
            const db = this.client.db(mongoDbName);
            const collection = db.collection(collectionName);
    
            const result = await collection.findOneAndUpdate(
                {_id: document._id},
                {
                    $set: document
                },
                {
                    upsert: true
                }
            );
            return result;
        } catch(err) {
            console.error(err);
        }
    }
    
    async deleteDocument(collectionName, document) {
        try {
            const db = this.client.db(mongoDbName);
            const collection = db.collection(collectionName);
    
            const result = await collection.deleteOne(
                {_id: document._id}
            );
            return result;
        } catch(err) {
            console.error(err);
        }
    }
}

export const mongo = new MongoHelper();
mongo.connect();
