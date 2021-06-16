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
