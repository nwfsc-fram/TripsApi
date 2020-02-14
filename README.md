# TripsApi
Simple micro-service to provide unique trip identifiers.

## Setup
1. Create a dbConfig.json file. Replace username and password with your couch credentials. 
```
{
    "dbConfig": {
      "applicationShortName_unused": "BOATNET_OBSERVER",
      "login": "https://username:password@nwcdevfram2.nwfsc2.noaa.gov:6984",
      "couchReadonlyDB_unused": "lookups-dev",
      "couchMasterDB_unused": "master-dev",
      "authServer": "https://localhost:9000/"
    }
}
```

2. Modify app.ts file line 85 and 86 to get rid of /src/ the new path should look like `./keys/cert.pem`

3. Ensure your keys directory is present if not, you'll have to get that from someone else. Those files are not currently available on github. 

## Run
1. Run `yarn start`

2. Download [Postman](https://www.postman.com/) you will use this to make API requests. Note: if you go to the localhost:xxx on your browser you'll see `Unable to locate the requested resource` this is normal, your requests must go through postman

3. Make a post request to the login api `https://localhost:3000/api/v1/login` to get a auth token for future requests. In the body section select raw and format should be set to JSON then fill in the following:
```
  {
     "username": "xxx",
     "password": "pw"
 }
```

4. Before making future requests, navigate tothe Authorization section and select type: bearer token. Paste the token there and your future requests will be properly authenticated 

