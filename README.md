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

## Updating the model
The model is stored in the openapi.yaml file. 

1. To update it go https://app.swaggerhub.com/apis/seth.gerou/Trips/0.0.1#/ swagger provides an editor where you can error check your model. Add your new API and make sure it doesn't have any errors
2. Once your model looks good and is free of errors download it by going to export (upper right corner) -> download api -> resolved yaml. 
3. This will download a .zip file, copy and pasted the openapi.yaml file into the github repo. 


## Run
1. Run `yarn start`

2. Download [Postman](https://www.postman.com/) you will use this to make API requests. Note: if you go to the localhost:xxx on your browser you'll see `Unable to locate the requested resource` this is normal, your requests must go through postman

Dev endpoint: https://nwcdevmeow1.nwfsc.noaa.gov:9004/api/v1/trips

Prod endpoint: https://www.nwfsc.noaa.gov/trips/api/v1/login

3. Make a post request to the login api `https://localhost:3000/api/v1/login` to get a auth token for future requests. In the body section select raw and format should be set to JSON then fill in the following:
```
  {
     "username": "xxx",
     "password": "pw"
 }
```
<img src="./login.PNG" alt="Login">

4. Before making future requests, navigate tothe Authorization section and select type: bearer token. Paste the token there and your future requests will be properly authenticated 

<img src="./token.PNG" alt="Login">

