import * as oracledb from 'oracledb';

const vmsOleConfig = require('../dbConfig.json').vmsOleConfig;

export async function getFishTicket(ftid: string): Promise<string[]> {
    let fishTicketRows: any = [];

    try {
      const pool = getPacfinOraclePool();
      const connection = await pool.getConnection();
      const result = await connection.execute(
        `SELECT PACFIN_SPECIES_CODE, LANDED_WEIGHT_LBS, NUM_OF_FISH, CONDITION_CODE, VESSEL_NUM
         FROM PACFIN.COMPREHENSIVE_FISH_TICKET
         WHERE FTID = :id ORDER BY PACFIN_SPECIES_CODE ASC`,
        [ftid],
      ).catch( error => console.log(error));
      closeOracleConnection(connection);

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

export async function getVesselFishTickets(req: any, res: any) {
  const vesselId = req.query.vesselId ? req.query.vesselId : '';
  const startDate = req.query.startDate ? req.query.startDate : '';
  const endDate = req.query.endDate ? req.query.endDate : '';

  let fishTicketRows: any = [];

  try {
    const pool = getPacfinOraclePool();
    const connection = await pool.getConnection();
    const result = await connection.execute(
      "SELECT LANDING_DATE, FTID, FISHER_LICENSE_NUM, PORT_NAME, SPECIES_CODE_NAME, PACFIN_SPECIES_CODE, CONDITION_NAME, CONDITION_CODE, NUM_OF_FISH, LANDED_WEIGHT_LBS, DECLARATION_CODES, DECLARATION_TYPES, VESSEL_NUM FROM PACFIN.COMPREHENSIVE_FISH_TICKET where VESSEL_NUM = :vesselId AND LANDING_DATE >= TO_DATE(:startDate, 'YYYY-MM-DD') AND LANDING_DATE <= TO_DATE(:endDate, 'YYYY-MM-DD') ORDER BY LANDING_DATE ASC",
      [vesselId, startDate, endDate],
    ).catch( error => console.log(error));
    closeOracleConnection(connection);

    if (result) {
      for (const row of result.rows) {
        const fishTicketRow = {};
        for (const [i, column] of result.metaData.entries()) {
          fishTicketRow[column.name] = row[i]
        }
        fishTicketRows.push(fishTicketRow);
      }
      res.status(200).json(fishTicketRows);
    } else {
      res.status(400).send('did not receive a response');
    }
  } catch (connErr) {
    console.error(connErr.message);
    res.status(400).send(connErr.message);
  }
}

export async function insertRow() {

  try {
    const pool = getObsprodOraclePool();
    const connection = await pool.getConnection();
    const result = await connection.execute(
      "INSERT INTO OBSPROD.IFQ_RECEIPTS_XML(FINAL_TRIP_NUMBER, FIRST_RECEIVER, IFQ_ACCOUNT_NUMBER)\
       VALUES(999999, 'ABC123', 'zzz222')"
      //  "INSERT INTO OBSPROD.IFQ_RECEIPTS_XML(FINAL_TRIP_NUMBER, FIRST_RECEIVER, IFQ_ACCOUNT_NUMBER)\
      //  VALUES(999999, 'ABC123', 'zzz222')"
    ).catch( error => console.log(error));
    closeOracleConnection(connection);
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

export async function getVesselSelections(req: any, res: any) {
  const year = req.query.year ? req.query.year : '';
  const pool = getObsprodOraclePool();
  const connection = await pool.getConnection();
  const result = await connection.execute(
    "SELECT f.fishery, f.fishery_id, sc.cycle_number, sc.start_date as cycle_start, sc.end_date as cycle_end, sc.notes as cycle_notes, sp.period_number, sp.start_date as period_start, sp.end_date as period_end, sp.notes as period_notes, sh.vessel_drvid, sh.vessel_name, sh.vessel_length, sh.permit_number, sh.permit_number_2, sh.permit_type, sh.license_number, sh.port_group as port_group_code, sh.random_number, sh.selection_status, (select description from lookups where lookup_type = 'SELECTION_STATUS_REASON' and lookup_value = sh.status_reason) status_reason, sh.status_reason as status_reason_id, sh.notes, sa.name, sa.address, sa.city, sa.state, sa.zip_code, sa.phone, (select description from lookups where lookup_type = 'SELECTION_ADDRESS_CATEGORY' and lookup_value = sa.address_category) address_category, sa.address_category as address_category_id FROM selection_cycles sc JOIN ( SELECT description as fishery ,lookup_value as fishery_id FROM lookups WHERE lookup_type = 'FISHERY') f on sc.fishery = f.fishery_id JOIN selection_periods sp ON sc.selection_cycle_id = sp.selection_cycle_id JOIN selection_history sh ON sp.selection_period_id = sh.selection_period_id LEFT JOIN selection_addresses sa ON sh.selection_history_id = sa.selection_history_id WHERE extract(year from sc.start_date) = :year ORDER BY period_end, cast(f.fishery_id as int), sh.vessel_name", [year]
  ).catch( error => console.log(error));

  closeOracleConnection(connection);
  if (result) {
    const selections = [];
      for (const row of result.rows) {
        const selection = {};
        for (const [i, column] of result.metaData.entries()) {
          selection[column.name] = row[i]
        }
        selections.push(selection);
      }
    res.status(200).json(selections);
  } else {
    res.status(400).send('did not receive a response');
  }
};

export async function getVesselWaivers(req: any, res: any) {
  const id = req.query.vesselId ? req.query.vesselId : '';
  const year = req.query.year ? req.query.year : '';
  const pool = getObsprodOraclePool();
  const connection = await pool.getConnection();
  let result = null;
  if (id) {
    result = await connection.execute(
      "SELECT w.waiver_id, w.created_by as created_by_id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as created_by, v.vessel_name, coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid, (select description from lookups where lookup_type = 'WAIVER_TYPE' and lookup_value = w.waiver_type) as waiver_type, (select description from lookups where lookup_type = 'WAIVER_REASON' and lookup_value = w.waiver_reason) as waiver_reason, w.fishery as fishery_id, (select description from lookups where lookup_type = 'FISHERY' and lookup_value = w.fishery) as fishery, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as contact, w.certificate_number as permit_or_license, w.issue_date, w.start_date, w.end_date, p.port_name, p.port_code, p.port_group, p.state as port_state, w.created_date as waiver_created_date, w.notes FROM waivers w JOIN users u ON w.created_by = u.user_id JOIN vessels v ON w.vessel_id = v.vessel_id LEFT JOIN contacts c ON w.contact_id = c.contact_id LEFT JOIN ports p ON w.landing_port_id = p.port_id WHERE extract(year from issue_date) = :year AND (v.state_reg_number = :id OR v.coast_guard_number = :id)", [year, id, id]
    ).catch( error => console.log(error));

    closeOracleConnection(connection);
  } else {
    result = await connection.execute(
      "SELECT w.waiver_id, w.created_by as created_by_id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) as created_by, v.vessel_name, coalesce(v.state_reg_number, v.coast_guard_number) as vessel_drvid, (select description from lookups where lookup_type = 'WAIVER_TYPE' and lookup_value = w.waiver_type) as waiver_type, (select description from lookups where lookup_type = 'WAIVER_REASON' and lookup_value = w.waiver_reason) as waiver_reason, w.fishery as fishery_id, (select description from lookups where lookup_type = 'FISHERY' and lookup_value = w.fishery) as fishery, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as contact, w.certificate_number as permit_or_license, w.issue_date, w.start_date, w.end_date, p.port_name, p.port_code, p.port_group, p.state as port_state, w.created_date as waiver_created_date, w.notes FROM waivers w JOIN users u ON w.created_by = u.user_id JOIN vessels v ON w.vessel_id = v.vessel_id LEFT JOIN contacts c ON w.contact_id = c.contact_id LEFT JOIN ports p ON w.landing_port_id = p.port_id WHERE extract(year from issue_date) = :year", [year]
    ).catch( error => console.log(error));

    closeOracleConnection(connection);
  }
  if (result) {
    const waivers = [];
      for (const row of result.rows) {
        const selection = {};
        for (const [i, column] of result.metaData.entries()) {
          selection[column.name] = row[i]
        }
        waivers.push(selection);
      }
    res.status(200).json(waivers);
  } else {
    res.status(400).send('did not receive a response');
  }
};

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
    const pool = getVmsOraclePool();
    const connection = await pool.getConnection();
    const result = await connection.execute(
      'SELECT MAX(confirmation_number) FROM "Declarations Transaction Table"'
    )
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

function closeOracleConnection(connection: any) {
    console.log('Closing oracledb connection.');
    connection.close();
}

function getPacfinOraclePool() {
    const pool = oracledb.getPool('pacfin');
    console.log(
        'Connect to pool ' +
        pool.poolAlias +
        ', pool connections open: ' +
        pool.connectionsOpen
    );
    return pool;
}

function getObsprodOraclePool() {
  oracledb.autoCommit = true;
  const pool = oracledb.getPool('obsprod');
  console.log(
      'Connect to pool ' +
      pool.poolAlias +
      ', pool connections open: ' +
      pool.connectionsOpen
  );
  return pool;
}

function getVmsOraclePool() {
  oracledb.autoCommit = true;
  const pool = oracledb.getPool('vms');
  console.log(
    'Connect to pool ' +
    pool.poolAlias +
    ', pool connections open: ' +
    pool.connectionsOpen
);
return pool;
}
