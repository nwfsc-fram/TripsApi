import { masterDev } from '../util/couchDB';

const emLookupTypes = [
    {lookup: 'em-source', title: 'source', usage: 'logbook, review', level: 'trip'},
    {lookup: 'port', title: 'departurePort" / "returnPort', usage: 'logbook, review', level: 'trip'},
    {lookup: 'us-state', title: 'departureState" / "returnState', usage: 'logbook, review', level: 'trip'},
    {lookup: 'fishery', title: 'fishery', usage: 'logbook', level: 'trip'},
    {lookup: 'fishery-sector', title: 'fisherySector', usage: 'review', level: 'trip'},
    {lookup: 'catch-handling-performance', title: 'catchHandlingPerformance', usage: 'review', level: 'haul'},
    {lookup: 'gear-type', title: 'gearTypeCode', usage: 'logbook, review', level: 'haul'},
    {lookup: 'system-performance', title: 'systemPerformance', usage: 'review', level: 'haul'},
    {lookup: 'catch-disposition', title: 'disposition', usage: 'logbook, review', level: 'catch'},
    {lookup: 'fate', title: 'fate', usage: 'review', level: 'catch'},
    {lookup: 'calc-weight-type', title: 'calcWeightType', usage: 'logbook, review', level: 'catch'}
];

export const head = '<html lang="en">\
                    <head>\
                    <meta charset="utf-8">\
                    <meta name="viewport" content="width=device-width, initial-scale=1">\
                    <link href="./static/bootstrap-4.5.2-dist/css/bootstrap.min.css" rel="stylesheet"/>\
                    <script src="./static/jquery/jquery-3.5.1.min.js"></script>\
                    <script src="./static/bootstrap-4.5.2-dist/js/bootstrap.min.js"></script>\
                    </head>';

export const header = '<body class="container"><header> \
                    <img src="./static/images/noaa-50th-logo.png" alt="noaa-logo" style="width: 200px"/> \
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
        tables += '<table style="width: 70%"><tr><th>Lookup</th><th>Description</th><th>Usage</th><th>Level</th></tr>';
        for (const line of rowLookups) {
            tables += '<tr><td>' + line.value[1] + '</td><td>' + line.value[0] + '</td>'
            tables += '<td>' + row.usage + '</td><td>' + row.level + '</td></tr>'
        }
        tables += '</table><br>';
    }
    return tables;
};

export const instructionsContent = () => {
    return '<h5>Instructions<h5><br>\
            <h6 id="httpsRequired">https required</h6>\
            <p class="inst-desc">The Trips API will not respond to http requests, please be sure all requests are prefixed with https.</p>\
            <h6 id="summary-structure">submission structure</h6>\
            <p class="inst-desc">EM review and logbook submissions share a common structure:<br>\
            trip details including a hauls (sets) array,<br>\
            each haul containing haul details and a catch array,<br>\
            with each catch containing catch details.</p>\
            <p class="inst-desc">\
                trip details<br>\
                hauls [<br>\
                    &nbsp;&nbsp;haul details<br>\
                    &nbsp;&nbsp;catch [<br>\
                        &nbsp;&nbsp;&nbsp;&nbsp;catch details<br>\
                        &nbsp;&nbsp;]<br>\
                    ]\
                </p>\
            <h6>dates and times</h6>\
            <h6>lost gear</h6>\
            <h6>screenshot submission</h6>\
            <h6>observer web</h6>\
                    <h6>task management</h6>\
                    <h6>e-logbook</h6>\
                    <h6>api submission portal</h6>\
            <h6>logging in</h6>\
                <h6>getting a login</h6>\
            <h6>query for trip number</h6>\
            <h6>submit new logbook data</h6>\
            <h6>update logbook data</h6>\
            <h6>submit a new review</h6>\
            <h6>update a review</h6>';
};

export const programContent = () => {
    return "program content";
};

export const docsContent = () => {
    // return '<div id="includeDocs"></div>';
    return '<iframe src="./api-docs/#/" style="width: 100%; height: 100%"></iframe>'
}

export const end = '</body></html>';

export const css = '<style> h3 {font-family: arial} table, th, td {border: 1px solid black; border-collapse: collapse; font-family: arial} th, td {padding: 5px;} .inst-desc {margin-left: 30px}</style>';
