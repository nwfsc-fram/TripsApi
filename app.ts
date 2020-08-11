const path = require('path');
const cors = require('cors');
const moment = require('moment');

// const { Pool } = require('pg');
// import * as oracledb from 'oracledb';

import * as express from 'express';
import * as https from 'https';
import * as fs from 'fs';
import { resolve } from 'path';

// const ODWdbConfig = require('./dbConfig.json').ODWdbConfig;

const app = express();
const port = 3000;

const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const swaggerDocument = YAML.load(path.resolve(__dirname, 'openapi.yaml'));

const OpenApiValidator = require('express-openapi-validator').OpenApiValidator;

express.static('public');

app.all('/*', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // restrict it to the required domain
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  // Set custom headers for CORS
  res.header(
    'Access-Control-Allow-Headers',
    'Content-type,Accept,X-Access-Token,X-Key,Authorization'
  );
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
})

app.use('/static', express.static('public'));

app.use(express.json());
app.use(cors());
app.disable('x-powered-by'); // Disable express version sharing

app.use('/spec', express.static(path.resolve(__dirname, 'openapi.yaml')));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

new OpenApiValidator({
    apiSpec: './openapi.yaml'
  }).install(app);

// Handle bad requests
app.use((err, req, res, next) => {
    if (!err) return next();
    console.log(moment().format(), 'Bad request. ', req.ip, err.message);
    return res.status(400).json({
      status: 400,
      error: 'Bad request.'
    });
  });

function anyBodyParser(req, res, next) {
  if (req.headers['content-type'] == "application/xml") {
    var data = '';
    req.setEncoding('utf8');
    req.on('data', function(chunk) {
      data += chunk;
    });
    req.on('end', function() {
      req.rawBody = data;
      next();
      });
  } else {
    next();
  }
}

app.use(anyBodyParser);

const commandLineArgs = require('command-line-args');

const optionDefinitions = [
  { name: 'port', alias: 'p', type: Number},
  { name: 'path', type: String} // Full path, dist/ will be added on
];

const options = commandLineArgs(optionDefinitions);
const PORT = options.port ? options.port : 8080;

app.use('/', require('./routes/index.ts'));

app.use(function (req, res, next) {
  res.status(404).send("Unable to locate the requested resource")
})

let publicPath = '';
if (options.path) {
  publicPath = resolve(__dirname, options.path)
} else {
  publicPath = resolve(__dirname, '/dist')
}

// app.listen(port, () => console.log(`Trips API listening on port ${port}!`));

const httpsServer = https.createServer(
  {
    key: fs.readFileSync('./src/keys/key.pem'),  // change these for dev (remove /src)
    cert: fs.readFileSync('./src/keys/cert.pem')
  },
  app
);

// launch an HTTPS Server
httpsServer.listen(PORT, () => {
  console.log(
    'Boatnet HTTPS Secure Server running at https://localhost:' + PORT
    );
    console.log('Dist path: ' + publicPath);
});

// export function getOraclePool() {
//   const pool = oracledb.getPool();
//   console.log(
//     'Connect to pool ' +
//       pool.poolAlias +
//       ', pool connections open: ' +
//       pool.connectionsOpen
//   );
//   return pool;
// }

// function createOraclePool() {
//   console.log('Creating oracle connection pool to', ODWdbConfig.connectString);
//   const oracleCredentials = {
//     user: ODWdbConfig.user,
//     password: ODWdbConfig.password,
//     connectString: ODWdbConfig.connectString
//   };
//   oracledb.fetchAsString = [ oracledb.CLOB ];

//   oracledb.createPool(oracleCredentials, function(err, pool) {
//     if (pool) {
//       console.log('Oracle connection pool created:', pool.poolAlias); // 'default'
//     } else {
//       console.log(err);
//     }
//   });
// }

// function closeOracleConnection(connection: any) {
//   console.log('Closing oracledb connection.');
//   connection.close();
// }

// createOraclePool();

// // getFishTicket('3906539');
// // getFishTicket('109746E');
// setTimeout( () => {
//   getFishTicket('50026972')
// }, 3000
// )

// export async function getFishTicket(
//   ftid: string
// ): Promise<string[]> {
//   let fishTicketRows = [];

//   // const bindvars = {
//   //   ftid,
//   //   ret: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 1000000 }
//   // };

//   try {
//     const pool = getOraclePool();
//     const connection = await pool.getConnection();
//     // const response = await connection.execute(
//     //   'BEGIN :ret := SELECT * FROM PACFIN.COMPREHENSIVE_FISH_TICKET where FTID = :ftid; END;',
//     //   bindvars
//     // );
//     // const result = JSON.parse(response.outBinds.ret);

//     const result = await connection.execute(
//       `SELECT *
//        FROM PACFIN.COMPREHENSIVE_FISH_TICKET
//        WHERE FTID = :id;`,
//       [ftid],
//     );

//     console.log(result);

//     closeOracleConnection(connection);
//     if (result) {
//       fishTicketRows = result;
//       console.log(fishTicketRows);
//       return result;
//     }
//   } catch (connErr) {
//     console.error(connErr.message);
//     throw new Error(connErr.message);
//   }

  // try {
  //   const pool = getOraclePool();
  //   const connection = await pool.getConnection();
  //   const rolesOracleResult = await getOracleRoles(connection, applicationName);
  //   closeOracleConnection(connection);
  //   if (rolesOracleResult && rolesOracleResult.roles) {
  //     for (let role of rolesOracleResult.roles) {
  //       if (!roles.includes(role.role_name)) {
  //         roles.push(role.role_name);
  //       }
  //     }
  //   }
  // } catch (err) {
  //   throw new Error(err);
  // }

  // if (roles.length) {
  //   return roles;
  // } else {
  //   console.log('No roles for', applicationName);
  //   throw new Error('No roles for ' + applicationName);
  // }
// }

// export function getFishTicketOld(ftid: string) {
//   pool.connect((err, client, done) => {
//     if (err) {
//       throw err
//     }
//     client.query('SELECT * FROM PACFIN.COMPREHENSIVE_FISH_TICKET where FTID = $1', [ftid], (err, res) => {
//       done()
//     if (err) {
//       console.log(err);
//     } else {
//       console.log(res.rows);
//     }
//   });
// })
// }

