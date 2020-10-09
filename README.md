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

2. Modify app.ts file line 103 and 104 to get rid of /src/ the new path should look like `./keys/cert.pem`

3. Ensure your keys directory is present if not, you'll have to get that from someone else. Those files are not currently available on github. 

## Updating the model
The model is stored in the openapi.yaml file. 

1. To update it go https://app.swaggerhub.com/apis/seth.gerou/Trips/0.0.1#/ swagger provides an editor where you can error check your model. Add your new API and make sure it doesn't have any errors
2. Once your model looks good and is free of errors download it by going to export (upper right corner) -> download api -> resolved yaml. 
3. This will download a .zip file, copy and pasted the openapi.yaml file into the github repo. 


## Run
1. Run `yarn start`

2. Make sure the dev-auth-server is up. To launch navigate to the boatnet/app/dev-auth-server directory and type 'yarn serve'

3. Download [Postman](https://www.postman.com/) you will use this to make API requests. Note: if you go to the localhost:xxx on your browser you'll see `Unable to locate the requested resource` this is normal, your requests must go through postman

Dev endpoint: https://nwcdevmeow1.nwfsc.noaa.gov:9004/api/v1/trips

Prod endpoint: https://www.webapps.nwfsc.noaa.gov/trips/api/v1/login

4. Make a post request to the login api `https://localhost:3000/api/v1/login` to get a auth token for future requests. In the body section select raw and format should be set to JSON then fill in the following:
```
  {
     "username": "xxx",
     "password": "pw"
 }
```
<img src="./login.PNG" alt="Login">

5. Before making future requests, navigate tothe Authorization section and select type: bearer token. Paste the token there and your future requests will be properly authenticated

<img src="./token.PNG" alt="Login">

# getFishTicket Capability:

the tripsApi background expansions processes rely on an Oracle connection to get fish ticket data.  credentials are configured in dbConfig.ODWdbConfig with a section like:

    "ODWdbConfig": {
      "user": "username",
      "password": "password",
      "connectString": "database:port/schema"
    },

# Oracle Client configuration

- For the oracledb module to work on windows, it requires the oracle instant client 12_1 binary downloadable here https://oracle.github.io/odpi/doc/installation.html#windows
- To run from cmd without instant client in system PATH:
  * Git Bash:
```
export PATH=$PATH:"/C/ORACLE/instantclient_12_1"
npm run server
```
  * CMD:

```
set PATH=%PATH%;C:\ORACLE\instantclient_12_1
npm run start
```

  * Powershell:

```
$env:Path += ";C:\ORACLE\instantclient_12_1"
```


# Email Capabilty:

the tripsApi exposes an emailing capability that is configured in dbConfig.mailConfig with a section like:
,
    "mailConfig": {
      "service": "gmail",
      "username": "first.last@noaa.gov",
      "password": "application specific password" -- set this up in gmail - https://myaccount.google.com/apppasswords
    }

sending mail as nmfs.nwfsc.fram.data.team@noaa.gov (instead of a personal NOAA address) requires configuration of an alias.
https://mail.google.com/mail/u/0/#settings/accounts in the 'Send mail as:' section, click 'Add another email address' and follow the instructions.
Note: you'll need to verify the address, so it needs to be one you have access to (you receive mails sent to the address).

