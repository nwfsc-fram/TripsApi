import _ = require('lodash');
import * as oracledb from 'oracledb';
const moment = require('moment');
import { masterDev } from './couchDB';

import { pacfinPool, obsProdPool, vmsPool } from './oracleClient';

export async function getFishTicket(ftid: string): Promise<string[]> {
    let fishTicketRows: any = [];

    try {
      const connection = await pacfinPool.getConnection();
      const result = await connection.execute(
        `SELECT PACFIN_SPECIES_CODE, LANDED_WEIGHT_LBS, NUM_OF_FISH, CONDITION_CODE, VESSEL_NUM
         FROM PACFIN.COMPREHENSIVE_FISH_TICKET
         WHERE FTID = :id ORDER BY PACFIN_SPECIES_CODE ASC`,
        [ftid],
      ).catch( error => console.log(error));
      pacfinPool.closeConnection();

      if (result) {
        for (const row of result.rows) {
          const fishTicketRow = {};
          for (const [i, column] of result.metaData.entries()) {
            fishTicketRow[column.name] = row[i]
          }
          fishTicketRows.push(fishTicketRow);
        }
        return fishTicketRows;
      }
    } catch (connErr) {
      console.error(connErr.message);
      throw new Error(connErr.message);
    }
  }

export async function getVesselFishTickets(vesselId, startDate, endDate) {

  let fishTicketRows: any = [];

  const connection = await pacfinPool.getConnection();
  const result = await connection.execute(
    "SELECT LANDING_DATE, FTID, FISHER_LICENSE_NUM, PORT_NAME, SPECIES_CODE_NAME, PACFIN_SPECIES_CODE, CONDITION_NAME, CONDITION_CODE, NUM_OF_FISH, LANDED_WEIGHT_LBS, DECLARATION_CODES, DECLARATION_TYPES, VESSEL_NUM FROM PACFIN.COMPREHENSIVE_FISH_TICKET where VESSEL_NUM = :vesselId AND LANDING_DATE >= TO_DATE(:startDate, 'YYYY-MM-DD') AND LANDING_DATE <= TO_DATE(:endDate, 'YYYY-MM-DD') ORDER BY LANDING_DATE ASC",
    [vesselId, startDate, endDate],
  ).catch( error => console.log(error));
  pacfinPool.closeConnection();

  if (result.rows.length > 0) {
    for (const row of result.rows) {
      const fishTicketRow = {};
      for (const [i, column] of result.metaData.entries()) {
        fishTicketRow[column.name] = row[i];
      }
      fishTicketRows.push(fishTicketRow);
    }
    return fishTicketRows;
  } else {
    return null;
  }
}

// export async function getVesselFishTickets(req: any, res: any) {
//   const vesselId = req.query.vesselId ? req.query.vesselId : '';
//   const startDate = req.query.startDate ? req.query.startDate : '';
//   const endDate = req.query.endDate ? req.query.endDate : '';

//   let fishTicketRows: any = [];

//   try {
//     const pool = getPacfinOraclePool();
//     const connection = await pool.getConnection();
//     const result = await connection.execute(
//       "SELECT LANDING_DATE, FTID, FISHER_LICENSE_NUM, PORT_NAME, SPECIES_CODE_NAME, PACFIN_SPECIES_CODE, CONDITION_NAME, CONDITION_CODE, NUM_OF_FISH, LANDED_WEIGHT_LBS, DECLARATION_CODES, DECLARATION_TYPES, VESSEL_NUM FROM PACFIN.COMPREHENSIVE_FISH_TICKET where VESSEL_NUM = :vesselId AND LANDING_DATE >= TO_DATE(:startDate, 'YYYY-MM-DD') AND LANDING_DATE <= TO_DATE(:endDate, 'YYYY-MM-DD') ORDER BY LANDING_DATE ASC",
//       [vesselId, startDate, endDate],
//     ).catch( error => console.log(error));
//     closeOracleConnection(connection);

//     if (result) {
//       for (const row of result.rows) {
//         const fishTicketRow = {};
//         for (const [i, column] of result.metaData.entries()) {
//           fishTicketRow[column.name] = row[i]
//         }
//         fishTicketRows.push(fishTicketRow);
//       }
//       res.status(200).json(fishTicketRows);
//     } else {
//       res.status(400).send('did not receive a response');
//     }
//   } catch (connErr) {
//     console.error(connErr.message);
//     res.status(400).send(connErr.message);
//   }
// }

export async function getOracleTrips(vesselId: any, startDate: any, endDate: any) {
  let tripRows: any = [];

  const connection = await obsProdPool.getConnection();
  const result = await connection.execute(
    "select t.trip_id ,(select description from lookups where lookup_type = 'TRIP_STATUS' and lookup_value = t.trip_status) as trip_status ,p.program_name ,(select description from lookups where lookup_type = 'FISHERY' and lookup_value = t.fishery) as fishery ,v.vessel_name ,coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid ,trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as skipper ,trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as observer ,to_char(t.departure_date, 'DD-MON-YY HH24:MI') as departure_date ,to_char(t.return_date, 'DD-MON-YY HH24:MI') as return_date ,rp.port_name as return_port ,dp.port_name as departure_port ,t.data_quality ,t.logbook_number ,t.observer_logbook ,t.license_number ,t.permit_number ,t.crew_size ,t.fish_processed ,t.partial_trip ,listagg(ft.fish_ticket_number, ',') over (partition by t.trip_id) as fish_tickets ,t.notes as trip_notes  from trips t join users u on t.created_by = u.user_id join vessels v on t.vessel_id = v.vessel_id left join contacts c on t.skipper_id = c.contact_id left join programs p on t.program_id = p.program_id left join ports dp on t.departure_port_id = dp.port_id left join ports rp on t.return_port_id = rp.port_id left join fish_tickets ft on t.trip_id = ft.trip_id  where coalesce(v.state_reg_number, v.coast_guard_number) = :vesselId and trunc(t.return_date) BETWEEN :startDate AND :endDate",
    [vesselId, startDate, endDate],
  ).catch( error => console.log(error));
  obsProdPool.closeConnection();
  if (result.rows.length > 0) {
    for (const row of result.rows) {
      const tripRow = {};
      for (const [i, column] of result.metaData.entries()) {
        tripRow[column.name] = row[i]
      }
      tripRows.push(tripRow);
    }
    return tripRows;
  } else {
    return [];
  }
}

// export async function getOracleTrips(req: any, res: any) {
//   const vesselId = req.query.vesselId ? req.query.vesselId : '';
//   const startDate = req.query.startDate ? moment(req.query.startDate).format('DD-MMM-YY') : '';
//   const endDate = req.query.endDate ? moment(req.query.endDate).format('DD-MMM-YY') : '';

//   let tripRows: any = [];

//   try {
//     const pool = getObsprodOraclePool();
//     const connection = await pool.getConnection();
//     const result = await connection.execute(
//       "select t.trip_id ,(select description from lookups where lookup_type = 'TRIP_STATUS' and lookup_value = t.trip_status) as trip_status ,p.program_name ,(select description from lookups where lookup_type = 'FISHERY' and lookup_value = t.fishery) as fishery ,v.vessel_name ,coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid ,trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as skipper ,trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as observer ,to_char(t.departure_date, 'DD-MON-YY HH24:MI') as departure_date ,to_char(t.return_date, 'DD-MON-YY HH24:MI') as return_date ,rp.port_name as return_port ,dp.port_name as departure_port ,t.data_quality ,t.logbook_number ,t.observer_logbook ,t.license_number ,t.permit_number ,t.crew_size ,t.fish_processed ,t.partial_trip ,listagg(ft.fish_ticket_number, ',') over (partition by t.trip_id) as fish_tickets ,t.notes as trip_notes  from trips t join users u on t.created_by = u.user_id join vessels v on t.vessel_id = v.vessel_id left join contacts c on t.skipper_id = c.contact_id left join programs p on t.program_id = p.program_id left join ports dp on t.departure_port_id = dp.port_id left join ports rp on t.return_port_id = rp.port_id left join fish_tickets ft on t.trip_id = ft.trip_id  where coalesce(v.state_reg_number, v.coast_guard_number) = :vesselId and trunc(t.return_date) BETWEEN :startDate AND :endDate",
//       [vesselId, startDate, endDate],
//     ).catch( error => console.log(error));
//     closeOracleConnection(connection);

//     if (result) {
//       for (const row of result.rows) {
//         const tripRow = {};
//         for (const [i, column] of result.metaData.entries()) {
//           tripRow[column.name] = row[i]
//         }
//         tripRows.push(tripRow);
//       }
//       res.status(200).json(tripRows);
//     } else {
//       res.status(400).send('did not receive a response');
//     }
//   } catch (connErr) {
//     console.error(connErr.message);
//     res.status(400).send(connErr.message);
//   }
// }

export async function insertRow() {

  try {
    const connection = await obsProdPool.getConnection();
    const result = await connection.execute(
      "INSERT INTO OBSPROD.IFQ_RECEIPTS_XML(FINAL_TRIP_NUMBER, FIRST_RECEIVER, IFQ_ACCOUNT_NUMBER)\
       VALUES(999999, 'ABC123', 'zzz222')"
      //  "INSERT INTO OBSPROD.IFQ_RECEIPTS_XML(FINAL_TRIP_NUMBER, FIRST_RECEIVER, IFQ_ACCOUNT_NUMBER)\
      //  VALUES(999999, 'ABC123', 'zzz222')"
    ).catch( error => console.log(error));
    obsProdPool.closeConnection();
    if (result) {
      return result;
    } else {
      return 'DID NOT SUCCEED!'
    }
  } catch (connErr) {
    console.error(connErr.message);
    throw new Error(connErr.message);
  }
}

export async function insertResultToIFQStaging(result) {
  let apiTrip = await masterDev.view('TripsApi', 'all_api_trips', {key: result.tripNum, reduce: false, include_docs: true});
  let logbook = await masterDev.view('TripsApi', 'all_api_catch', {key: result.tripNum, reduce: false, include_docs: true});
  logbook = logbook.rows.map( (row) => row.doc).filter( (row) => row.source === 'logbook');
  apiTrip = apiTrip.rows[0].doc;
  const vesselId = apiTrip.vesselId;
  console.log(vesselId);
  const year = moment(logbook.returnDateTime).format('YYYY');
  console.log(year);
  const connection = await obsProdPool.getConnection();
  let vesselAccount = await connection.execute(
    "SELECT account_identifier FROM vessel_to_permit_v WHERE quota_year = :year AND status = 'Active' AND vessel_registration_number = :vesselId", [year, vesselId]
  )
  console.log(vesselAccount);
  vesselAccount = vesselAccount.rows[0][0];
  obsProdPool.closeConnection();
  console.log(vesselAccount);
}

export async function getVesselSelections(year: any) {
  const connection = await obsProdPool.getConnection();
  const result = await connection.execute(
    "SELECT f.fishery, f.fishery_id, sc.cycle_number, sc.start_date as cycle_start, sc.end_date as cycle_end, sc.notes as cycle_notes, sp.period_number, sp.start_date as period_start, sp.end_date as period_end, sp.notes as period_notes, sh.vessel_drvid, sh.vessel_name, sh.vessel_length, sh.permit_number, sh.permit_number_2, sh.permit_type, sh.license_number, sh.port_group as port_group_code, sh.random_number, sh.selection_status, (select description from lookups where lookup_type = 'SELECTION_STATUS_REASON' and lookup_value = sh.status_reason) status_reason, sh.status_reason as status_reason_id, sh.notes, sa.name, sa.address, sa.city, sa.state, sa.zip_code, sa.phone, (select description from lookups where lookup_type = 'SELECTION_ADDRESS_CATEGORY' and lookup_value = sa.address_category) address_category, sa.address_category as address_category_id FROM selection_cycles sc JOIN ( SELECT description as fishery ,lookup_value as fishery_id FROM lookups WHERE lookup_type = 'FISHERY') f on sc.fishery = f.fishery_id JOIN selection_periods sp ON sc.selection_cycle_id = sp.selection_cycle_id JOIN selection_history sh ON sp.selection_period_id = sh.selection_period_id LEFT JOIN selection_addresses sa ON sh.selection_history_id = sa.selection_history_id WHERE extract(year from sc.start_date) = :year ORDER BY period_end, cast(f.fishery_id as int), sh.vessel_name", [year]
  ).catch( error => console.log(error));
  obsProdPool.closeConnection();

  if (result.rows.length > 0) {
    const selections = [];
      for (const row of result.rows) {
        const selection = {};
        for (const [i, column] of result.metaData.entries()) {
          selection[column.name] = row[i]
        }
        selections.push(selection);
      }
    return selections
  } else {
    return null;
  }
}

// export async function getVesselSelections(req: any, res: any) {
//   const year = req.query.year ? req.query.year : '';
//   const pool = getObsprodOraclePool();
//   const connection = await pool.getConnection();
//   const result = await connection.execute(
//     "SELECT f.fishery, f.fishery_id, sc.cycle_number, sc.start_date as cycle_start, sc.end_date as cycle_end, sc.notes as cycle_notes, sp.period_number, sp.start_date as period_start, sp.end_date as period_end, sp.notes as period_notes, sh.vessel_drvid, sh.vessel_name, sh.vessel_length, sh.permit_number, sh.permit_number_2, sh.permit_type, sh.license_number, sh.port_group as port_group_code, sh.random_number, sh.selection_status, (select description from lookups where lookup_type = 'SELECTION_STATUS_REASON' and lookup_value = sh.status_reason) status_reason, sh.status_reason as status_reason_id, sh.notes, sa.name, sa.address, sa.city, sa.state, sa.zip_code, sa.phone, (select description from lookups where lookup_type = 'SELECTION_ADDRESS_CATEGORY' and lookup_value = sa.address_category) address_category, sa.address_category as address_category_id FROM selection_cycles sc JOIN ( SELECT description as fishery ,lookup_value as fishery_id FROM lookups WHERE lookup_type = 'FISHERY') f on sc.fishery = f.fishery_id JOIN selection_periods sp ON sc.selection_cycle_id = sp.selection_cycle_id JOIN selection_history sh ON sp.selection_period_id = sh.selection_period_id LEFT JOIN selection_addresses sa ON sh.selection_history_id = sa.selection_history_id WHERE extract(year from sc.start_date) = :year ORDER BY period_end, cast(f.fishery_id as int), sh.vessel_name", [year]
//   ).catch( error => console.log(error));

//   closeOracleConnection(connection);
//   if (result) {
//     const selections = [];
//       for (const row of result.rows) {
//         const selection = {};
//         for (const [i, column] of result.metaData.entries()) {
//           selection[column.name] = row[i]
//         }
//         selections.push(selection);
//       }
//     res.status(200).json(selections);
//   } else {
//     res.status(400).send('did not receive a response');
//   }
// };

// export async function getVesselWaivers(req: any, res: any) {
//   const id = req.query.vesselId ? req.query.vesselId : '';
//   const year = req.query.year ? req.query.year : '';
//   const pool = getObsprodOraclePool();
//   const connection = await pool.getConnection();
//   let result = null;
//   if (id) {
//     result = await connection.execute(
//       "SELECT w.waiver_id, w.created_by as created_by_id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as created_by, v.vessel_name, coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid, (select description from lookups where lookup_type = 'WAIVER_TYPE' and lookup_value = w.waiver_type) as waiver_type, (select description from lookups where lookup_type = 'WAIVER_REASON' and lookup_value = w.waiver_reason) as waiver_reason, w.fishery as fishery_id, (select description from lookups where lookup_type = 'FISHERY' and lookup_value = w.fishery) as fishery, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as contact, w.certificate_number as permit_or_license, w.issue_date, w.start_date, w.end_date, p.port_name, p.port_code, p.port_group, p.state as port_state, w.created_date as waiver_created_date, w.notes FROM waivers w JOIN users u ON w.created_by = u.user_id JOIN vessels v ON w.vessel_id = v.vessel_id LEFT JOIN contacts c ON w.contact_id = c.contact_id LEFT JOIN ports p ON w.landing_port_id = p.port_id WHERE extract(year from issue_date) = :year AND (v.state_reg_number = :id OR v.coast_guard_number = :id)", [year, id, id]
//     ).catch( error => console.log(error));

//     closeOracleConnection(connection);
//   } else {
//     result = await connection.execute(
//       "SELECT w.waiver_id, w.created_by as created_by_id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as created_by, v.vessel_name, coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid, (select description from lookups where lookup_type = 'WAIVER_TYPE' and lookup_value = w.waiver_type) as waiver_type, (select description from lookups where lookup_type = 'WAIVER_REASON' and lookup_value = w.waiver_reason) as waiver_reason, w.fishery as fishery_id, (select description from lookups where lookup_type = 'FISHERY' and lookup_value = w.fishery) as fishery, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as contact, w.certificate_number as permit_or_license, w.issue_date, w.start_date, w.end_date, p.port_name, p.port_code, p.port_group, p.state as port_state, w.created_date as waiver_created_date, w.notes FROM waivers w JOIN users u ON w.created_by = u.user_id JOIN vessels v ON w.vessel_id = v.vessel_id LEFT JOIN contacts c ON w.contact_id = c.contact_id LEFT JOIN ports p ON w.landing_port_id = p.port_id WHERE extract(year from issue_date) = :year", [year]
//     ).catch( error => console.log(error));

//     closeOracleConnection(connection);
//   }
//   if (result) {
//     const waivers = [];
//       for (const row of result.rows) {
//         const selection = {};
//         for (const [i, column] of result.metaData.entries()) {
//           selection[column.name] = row[i]
//         }
//         waivers.push(selection);
//       }
//     res.status(200).json(waivers);
//   } else {
//     res.status(400).send('did not receive a response');
//   }
// };

export async function fishTicketQuery(req: any, res: any) {
  const result = await getFishTicket(req.query.ftid);
  if (result) {
    res.status(200).json(result);
  } else {
    res.status(400).send('did not receive a response');
  }
};

export async function vmsDBTest(req: any, res: any) {
  try {
    const connection = await vmsPool.getConnection();
    const result = await connection.execute(
      'SELECT MAX(CONFIRMATION_NUMBER) FROM vTrack.NWD_VESSEL_TRANSACTIONS'
    )
    vmsPool.closeConnection();
    if (result) {
      res.status(200).json(result);
    } else {
      res.status(400).send('did not receive a response');
    }
  } catch (err) {
    res.status(400).send(err.message);
    throw new Error(err.message);
  }
}

export async function checkPasscode(vesselId: any, passcode: any) {
  try {
    const connection = await vmsPool.getConnection();
    const result = await connection.execute(
      'SELECT VESSEL_PASSCODE FROM vTrack.NWD_VESSEL_INFORMATION WHERE VESSEL_DOC_NUMBER = :vesselId',
      [vesselId]
    )
   vmsPool.closeConnection();
    if (result.rows > 0) {
      const resultPasscode = result.rows[0][0]
      return resultPasscode == passcode;
    } else {
      return false;
    }
  } catch (err) {
    return false;
  }
}

export async function getRecentDeclarations(req: any, res: any) {
  try {
    const vesselId = req.query.vesselId;
    const connection = await vmsPool.getConnection();
    const result = await connection.execute(
      'select transaction_date, transaction_code, transaction_contact_name from (select * from vtrack.nwd_vessel_transactions where vessel_doc_number=:vesselId order by transaction_date desc) where rownum <= 10',
      [vesselId]
    )
    vmsPool.closeConnection();
    if (result !== 'no rows selected') {
      res.status(200).json(result);
    } else {
      res.status(200).send('no declarations returned');
    }
  } catch (err) {
    res.status(400).send(err);
  }
}

export async function saveDeclaration(req: any, res: any) {
  try {
    const connection = await vmsPool.getConnection();
    const maxConfNum = await connection.execute(
      'SELECT max(CONFIRMATION_NUMBER) FROM vTrack.NWD_VESSEL_TRANSACTIONS'
    )
    const newConfNum = parseInt(maxConfNum.rows[0][0], 10) + 1;
    const newDeclarations = [];
    for (const declaration of req.body.declarations) {
      const newDeclaration = await connection.execute(
        "INSERT INTO vTrack.NWD_VESSEL_TRANSACTIONS ( VESSEL_PASSCODE, VESSEL_DOC_NUMBER, TRANSACTION_TYPE, CONFIRMATION_NUMBER, TRANSACTION_DATE, TRANSACTION_TIME, TRANSACTION_CONTACT_NAME, VMS_TECH, COMMENTS, TRANSACTION_CODE) VALUES (:VESSEL_PASSCODE, :VESSEL_DOC_NUMBER, :TRANSACTION_TYPE, :CONFIRMATION_NUMBER, TO_DATE(:TRANSACTION_DATE, 'DD-Month-YY'), TO_DATE(:TRANSACTION_TIME, 'DD-Month-YY HH:MI'), :TRANSACTION_CONTACT_NAME, :VMS_TECH, :COMMENTS, :TRANSACTION_CODE)", [declaration.VESSEL_PASSCODE, declaration.VESSEL_DOC_NUMBER, declaration.TRANSACTION_TYPE, newConfNum.toString(), moment(declaration.TRANSACTION_DATE).format('DD-MMMM-YY'), moment(declaration.TRANSACTION_TIME).format('DD-MMMM-YY HH:mm'), declaration.TRANSACTION_CONTACT_NAME, declaration.VMS_TECH, declaration.COMMENTS, declaration.TRANSACTION_CODE]
      )
      newDeclarations.push(newDeclaration);
    }
    let returnVal = {
      declarations: req.body.declarations,
      newConfNum,
      newDeclarations
    }
    vmsPool.closeConnection();
    if (returnVal) {
      res.status(200).json(returnVal);
    } else {
      res.status(200).send('max conf query succeeded but not as expected.');
    }
  } catch (err) {
    res.status(400).send(err);
  }
}
