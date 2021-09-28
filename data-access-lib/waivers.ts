import { mongo } from '../util/mongoClient';
import { obsProdPool } from '../util/oracleClient';
import { databaseClient } from '../routes/index';
import { masterDev, dbConfig } from '../util/couchDB';
export class Waivers {
    getById() {

    }

    async getByIdAndYear(id: string, year: number, dbClient: string) {
        let waivers = [];
        if (dbClient === databaseClient.Oracle) {
            const connection = await obsProdPool.getConnection();
            let result = null;
            if (id) {
                result = await connection.execute(
                "SELECT w.waiver_id, w.created_by as created_by_id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as created_by, v.vessel_name, coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid, (select description from lookups where lookup_type = 'WAIVER_TYPE' and lookup_value = w.waiver_type) as waiver_type, (select description from lookups where lookup_type = 'WAIVER_REASON' and lookup_value = w.waiver_reason) as waiver_reason, w.fishery as fishery_id, (select description from lookups where lookup_type = 'FISHERY' and lookup_value = w.fishery) as fishery, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as contact, w.certificate_number as permit_or_license, w.issue_date, w.start_date, w.end_date, p.port_name, p.port_code, p.port_group, p.state as port_state, w.created_date as waiver_created_date, w.notes FROM waivers w JOIN users u ON w.created_by = u.user_id JOIN vessels v ON w.vessel_id = v.vessel_id LEFT JOIN contacts c ON w.contact_id = c.contact_id LEFT JOIN ports p ON w.landing_port_id = p.port_id WHERE extract(year from issue_date) = :year AND (v.state_reg_number = :id OR v.coast_guard_number = :id)", [year, id, id]
                ).catch( error => console.log(error));

            obsProdPool.closeConnection();
            } else {
                result = await connection.execute(
                "SELECT w.waiver_id, w.created_by as created_by_id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as created_by, v.vessel_name, coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid, (select description from lookups where lookup_type = 'WAIVER_TYPE' and lookup_value = w.waiver_type) as waiver_type, (select description from lookups where lookup_type = 'WAIVER_REASON' and lookup_value = w.waiver_reason) as waiver_reason, w.fishery as fishery_id, (select description from lookups where lookup_type = 'FISHERY' and lookup_value = w.fishery) as fishery, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as contact, w.certificate_number as permit_or_license, w.issue_date, w.start_date, w.end_date, p.port_name, p.port_code, p.port_group, p.state as port_state, w.created_date as waiver_created_date, w.notes FROM waivers w JOIN users u ON w.created_by = u.user_id JOIN vessels v ON w.vessel_id = v.vessel_id LEFT JOIN contacts c ON w.contact_id = c.contact_id LEFT JOIN ports p ON w.landing_port_id = p.port_id WHERE extract(year from issue_date) = :year", [year]
                ).catch( error => console.log(error));

            obsProdPool.closeConnection();
            }
            if (result.rows.length > 0) {
                for (const row of result.rows) {
                    const selection = {};
                    for (const [i, column] of result.metaData.entries()) {
                    selection[column.name] = row[i]
                    }
                    waivers.push(selection);
                }
                return waivers;
            } else {
                return null;
            }
        } else if (dbClient === databaseClient.Couch) {
            const moment = require('moment');
            const waiversQuery = await masterDev.view(
                'obs_web', 
                'waiverId',
                {"reduce": false, "descending": true, include_docs: true}
            );
            waivers = waiversQuery.rows
                .filter((row: any) => {
                    const curr = row.doc;
                    let status = false;
                    if (curr.issueDate) {
                        status = moment(curr.createdDate).format('YYYY') === year;
                    }
                    if (status && id && curr.vessel) {
                        status = (curr.vessel.stateRegulationNumber === id || curr.vessel.coastGuardNumber === id);
                    }
                    return status;
                })
                .map( (row: any) => row.doc);
            return waivers;
        } else {
            let queryParams: any;
            const bodyQuery = '';
            const bodyOptions = '';
            if (id) {
                queryParams = {
                    $or: [{ "vessel.stateRegulationNumber": id}, { "vessel.coastGuardNumber": id}],
                    issueDate: { $gt: year + '-01-01', $lt: year + '-12-31' }
                }
            } else {
                queryParams = {
                    issueDate: { $gt: year + '-01-01', $lt: year + '-12-31' }
                }
            }
            const s = await mongo.findDocuments('boatnetdb', 'waivers', (documents) => {
                waivers.push.apply(waivers, documents);
            }, queryParams, bodyQuery, bodyOptions);
            return waivers;
        }
    }

    save() {

    }
}