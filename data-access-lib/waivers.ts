import { mongo } from '../util/mongoClient';
import { obsProdPool } from '../util/oracleClient';
import { databaseClient } from '../routes/index';
import { dbConfig, masterDev } from '../util/couchDB';

export class Waivers {
    async getById(id: string, dbClient: string) {
        let response: any;
        if (dbConfig === databaseClient.Oracle) {
            // oracle doesn't seem to have ids so leaving this blank
        } else if (dbClient === databaseClient.Couch) {
            response = await masterDev.get(id);
            response = this.formatDoc(response);
        } else {
            await mongo.getDocById('boatnetdb', 'waivers', (document) => {
                response = (this.formatDoc(document));
            }, id)
        }
        return response;
    }

    async getByIdAndYear(id: string, year: number, dbClient: string) {
        let waivers: any[] = [];
        let result = null;
        if (dbClient === databaseClient.Oracle) {
            if (id) {
                result = await obsProdPool.getData("SELECT w.waiver_id, w.created_by as created_by_id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as created_by, v.vessel_name, coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid, (select description from lookups where lookup_type = 'WAIVER_TYPE' and lookup_value = w.waiver_type) as waiver_type, (select description from lookups where lookup_type = 'WAIVER_REASON' and lookup_value = w.waiver_reason) as waiver_reason, w.fishery as fishery_id, (select description from lookups where lookup_type = 'FISHERY' and lookup_value = w.fishery) as fishery, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as contact, w.certificate_number as permit_or_license, w.issue_date, w.start_date, w.end_date, p.port_name, p.port_code, p.port_group, p.state as port_state, w.created_date as waiver_created_date, w.notes FROM waivers w JOIN users u ON w.created_by = u.user_id JOIN vessels v ON w.vessel_id = v.vessel_id LEFT JOIN contacts c ON w.contact_id = c.contact_id LEFT JOIN ports p ON w.landing_port_id = p.port_id WHERE extract(year from issue_date) = :year AND (v.state_reg_number = :id OR v.coast_guard_number = :id)", [year, id, id]);
            } else {
                result = await obsProdPool.getData("SELECT w.waiver_id, w.created_by as created_by_id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as created_by, v.vessel_name, coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid, (select description from lookups where lookup_type = 'WAIVER_TYPE' and lookup_value = w.waiver_type) as waiver_type, (select description from lookups where lookup_type = 'WAIVER_REASON' and lookup_value = w.waiver_reason) as waiver_reason, w.fishery as fishery_id, (select description from lookups where lookup_type = 'FISHERY' and lookup_value = w.fishery) as fishery, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as contact, w.certificate_number as permit_or_license, w.issue_date, w.start_date, w.end_date, p.port_name, p.port_code, p.port_group, p.state as port_state, w.created_date as waiver_created_date, w.notes FROM waivers w JOIN users u ON w.created_by = u.user_id JOIN vessels v ON w.vessel_id = v.vessel_id LEFT JOIN contacts c ON w.contact_id = c.contact_id LEFT JOIN ports p ON w.landing_port_id = p.port_id WHERE extract(year from issue_date) = :year", [year]);
            }
            if (result.rows.length > 0) {
                for (const row of result.rows) {
                    const selection = {};
                    selection['waiverId'] = row[0];
                    selection['startDate'] = row[12];
                    selection['endDate'] = row[13];
                    selection['vesselName'] = row[3];
                    selection['vesselId'] = row[4];
                    selection['fishery'] = row[8];
                    selection['permit'] = row[10];
                    selection['contract'] = row[9];
                    selection['issuer'] = databaseClient.Oracle;
                    selection['issueDate'] = row[11];
                    selection['type'] = row[5];
                    selection['reason'] = row[6];
                    selection['notes'] = row[19];
                    selection['source'] = databaseClient.Oracle;
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
                .map( (row: any) => {
                    const doc = row.doc;
                    return this.formatDoc(doc);
                });
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
                console.log('getting mongo ' + year)
            }
            waivers = await mongo.findDocuments('boatnetdb', 'waivers', queryParams, bodyQuery, bodyOptions);
            return waivers;
        }
    }

    formatDoc(doc: any) {
        return {
            waiverId: doc.waiverId,
            startDate: doc.startDate,
            endDate: doc.endDate,
            vesselName: doc.vessel ? doc.vessel.vesselName : '',
            vesselId: doc.vessel ? (doc.vessel.stateRegulationNumber ? doc.vessel.stateRegulationNumber : doc.vessel.coastGuardNumber) : '',
            fishery: doc.fishery ? doc.fishery.description : '',
            permit: doc.certificateNumber ? doc.certificateNumber.permitNumber : '',
            contract: doc.contract ? doc.contract.firstName + ' ' + doc.contract.lastName : '',
            issuer: doc.createdBy,
            issueDate: doc.issueDate,
            type: doc.waiverType ? doc.waiverType.description : '',
            reason: doc.reason ? doc.reason.description : '',
            notes: doc.notes,
            source: 'BOATNET'
        }
    }

    async save(doc: any, dbClient: string) {
        if (dbConfig === databaseClient.Oracle) {
            if (doc.waiverId) {
                //upsert
            } else {
                //insert
            }
        } else if (dbClient === databaseClient.Couch) {
            await masterDev.insert();
        } else {

            
        }
    }
}
export const waivers = new Waivers();
