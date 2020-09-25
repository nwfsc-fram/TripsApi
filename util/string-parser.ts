const parseString = require('xml2js').parseString;

export const stringParser = function(req) {
    parseString(req.rawBody, {explicitArray: false}, function(err, result) {
        req.body = JSON.parse(JSON.stringify(result.root));
        if (req.body.permits && typeof req.body.permits === 'string') { req.body.permits = [req.body.permits] }
        if (req.body.fisheries && typeof req.body.fisheries === 'string') { req.body.fisheries = [req.body.fisheries] }
        if (req.body.buyers && typeof req.body.buyers === 'string') { req.body.buyers = [req.body.buyers] }
        if (req.body.fishTickets) {
            for (const fishTicket of req.body.fishTickets) {
                fishTicket.fishTicketNumber = [fishTicket.fishTicketNumber]
                fishTicket.fishTicketDate = [fishTicket.fishTicketDate]
            }
        }

        for (const attrib of Object.keys(req.body)) {
            if (!['gearTypeDescription', 'comments', 'targetStrategy', 'fishTickets'].includes(attrib) && attrib !== 'departureDateTime' && attrib !== 'returnDateTime' && parseFloat(req.body[attrib])) { req.body[attrib] = parseFloat(req.body[attrib]) }
            if (req.body[attrib] == 'true') { req.body[attrib] = true; }
            if (req.body[attrib] == 'false') { req.body[attrib] = false; }
            if (attrib == 'hauls') {
                for (const haul of req.body[attrib]) {
                    for (const haulAttrib of Object.keys(haul)) {
                        if (!['gearTypeDescription', 'comments', 'targetStrategy', 'catch'].includes(haulAttrib) && haulAttrib !== 'startDateTime' && haulAttrib !== 'endDateTime' && typeof parseFloat(haul[haulAttrib]) == 'number') { haul[haulAttrib] = parseFloat(haul[haulAttrib]) }
                        if (haul[haulAttrib] == 'true') { haul[haulAttrib] = true; }
                        if (haul[haulAttrib] == 'false') { haul[haulAttrib] = false; }
                        if (haulAttrib == 'catch') {
                            for (const catchItem of haul[haulAttrib]) {
                                for (const catchAttrib of Object.keys(catchItem)) {
                                    if (typeof parseFloat(catchItem[catchAttrib]) == 'number' && !['catchId', 'catchDisposition', 'speciesCode', 'calcWeightType', 'comments'].includes(catchAttrib)) { catchItem[catchAttrib] = parseFloat(catchItem[catchAttrib]) }
                                    else if (catchItem[catchAttrib] == 'true') { catchItem[catchAttrib] = true; }
                                    else if (catchItem[catchAttrib] == 'false') { catchItem[catchAttrib] = false; }
                                    else { catchItem[catchAttrib] = catchItem[catchAttrib]}
                                }
                            }
                        }
                    }
                }
            }
        }
        return req;
    })
};
