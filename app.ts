const path = require('path');
const cors = require('cors');
const moment = require('moment');

const express = require('express');
const app = express();
const port = 3000;

const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const swaggerDocument = YAML.load(path.resolve(__dirname, 'openapi.yaml'));

const OpenApiValidator = require('express-openapi-validator').OpenApiValidator;

// const keys = ["1", "2", "3"]
// masterDev.fetch({keys: keys}).then((body) => {
//   console.log(body.rows[0].id)
// })

// masterDev.insert({type: "Trash", value: "Delete Me"}).then((body) => {
//   console.log(body)
// })

express.static('public');

app.all('/*', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // restrict it to the required domain
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  // Set custom headers for CORS
  res.header(
    'Access-Control-Allow-Headers',
    'Content-type,Accept,X-Access-Token,X-Key'
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

const commandLineArgs = require('command-line-args');

// app.get('/', (req, res) => res.send('Hello World!'));

app.get('/fish', (req, res) => {
    console.log(req.query.name)
    res.send('Hello Fish!')
});

app.get('/fish/:fishId', (req, res) => {
    console.log(req.query.name)
    const fishId = req.params.fishId
    // res.json(req.params)
    // res.sendStatus('200')
    // res.render('<div>This is some test html.</div>')
    res.status(400).send('Bad Request - Unable to locate ' + fishId)
});

app.use('/', require('./routes/index.ts'));

app.use(function (req, res, next) {
  res.status(404).send("Unable to locate the requested resource")
})

app.listen(port, () => console.log(`Trips API listening on port ${port}!`));
