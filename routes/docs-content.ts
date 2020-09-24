const dbConfig = require('../dbConfig.json').dbConfig;
const couchDB = require('nano')(dbConfig.login);
const masterDev = couchDB.db.use('master-dev');

const emLookupTypes = [
    {lookup: 'em-source', title: 'source', usage: 'logbook, review', level: 'trip'},
    {lookup: 'port', title: 'departurePort" / "returnPort', usage: 'logbook, review', level: 'trip'},
    {lookup: 'us-state', title: 'departureState" / "returnState', usage: 'logbook, review', level: 'trip'},
    {lookup: 'fishery', title: 'fishery', usage: 'logbook', level: 'trip'},
    {lookup: 'fishery-sector', title: 'fisherySector', usage: 'review', level: 'trip'},
    {lookup: 'catch-handling-performance', title: 'catchHandlinePerformance', usage: 'review', level: 'haul'},
    {lookup: 'gear-type', title: 'gearTypeCode', usage: 'logbook, review', level: 'haul'},
    {lookup: 'system-performance', title: 'systemPerformance', usage: 'review', level: 'haul'},
    {lookup: 'catch-disposition', title: 'disposition', usage: 'logbook, review', level: 'catch'},
    {lookup: 'fate', title: 'fate', usage: 'logbook, review', level: 'catch'},
    {lookup: 'calc-weight-type', title: 'calcWeightType', usage: 'logbook, review', level: 'catch'}
];

export const head = '<html lang="en">\
                    <head>\
                    <meta charset="utf-8">\
                    <meta name="viewport" content="width=device-width, initial-scale=1">\
                    <link href="/static/bootstrap-4.5.2-dist/css/bootstrap.min.css" rel="stylesheet"/>\
                    <script src="/static/jquery/jquery-3.5.1.min.js"></script>\
                    <script src="/static/bootstrap-4.5.2-dist/js/bootstrap.min.js"></script>\
                    <script> $(function(){$("#includeDocs").load("/static/spec.html"); });</script> \
                    </head>';

export const header = '<body class="container"><header> \
                    <img src="/static/images/noaa-50th-logo.png" alt="noaa-logo" style="width: 200px"/> \
                    <h3>Northwest Fisheries Science Center Trips Api Documentation</h3> \
                    </header>';

export const nav = '<nav class="navbar navbar-expand-md navbar-light bg-light">\
                        <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navBar" aria-controls="navBar" aria-expanded="false" aria-label="Toggle navigation"><span class="navbar-toggler-icon"></span></button>\
                        <div class="collapse navbar-collapse" id="navBar">\
                            <ul class="navbar-nav mr-auto">\
                                <li class="nav-item">\
                                    <a class="nav-link" href="./instructions">Instructions</a> \
                                </li>\
                                <li class="nav-item">\
                                    <a class="nav-link" href="./docs">Api Docs</a>\
                                </li>\
                                <li class="nav-item">\
                                    <a class="nav-link" href="./lookups">Lookups</a> \
                                </li>\
                                <li class="nav-item">\
                                    <a class="nav-link" href="./program">Program</a>\
                                </li>\
                            </ul>\
                        </div>\
                    </nav><br>';

export const lookupTables = async () => {
    let tables = ''
    const lookupResults = await masterDev.view('TripsApi', 'all_em_lookups', {include_docs: false, reduce: false });
    for (const row of emLookupTypes) {
        const rowLookups = lookupResults.rows.filter( (couchRow: any) => couchRow.key === row.lookup );
        tables += '<h5 id="' + row.title + '">Field: "' + row.title + '"</h5>';
        tables += '<table><tr><th>Lookup</th><th>Description</th><th>Usage</th><th>Level</th></tr>';
        for (const line of rowLookups) {
            tables += '<tr><td>' + line.value[1] + '</td><td>' + line.value[0] + '</td>'
            tables += '<td>' + row.usage + '</td><td>' + row.level + '</td></tr>'
        }
        tables += '</table><br>';
    }
    return tables;
};

export const instructionsContent = () => {
    return '<h5>Instructions<h5>\
            <ul>\
                <li>https required</li>\
                <li>dates and times</li>\
                <li>review summary structure</li>\
                <li>lost gear</li>\
                <li>screenshot submission</li>\
                <li>observer web</li>\
                    <ul>\
                        <li>task management</li>\
                        <li>e-logbook</li>\
                        <li>api submission portal</li>\
                    </ul>\
                <li>logging in</li>\
                <ul>\
                    <li>getting a login</li>\
                </ul>\
                <li>query for trip number</li>\
                <li>submit new logbook data</li>\
                <li>update logbook data</li>\
                <li>submit a new review</li>\
                <li>update a review</li>\
            </ul>';
};

export const programContent = () => {
    return "program content";
};

export const docsContent = () => {
    return '<div id="includeDocs"></div>';
}

export const end = '</body></html>';

export const css = '<style> h3 {font-family: arial} table, th, td {border: 1px solid black; border-collapse: collapse; font-family: arial} th, td { padding: 5px;}</style>';
