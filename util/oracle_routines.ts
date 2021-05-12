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

export async function vmsDBTest() {
  // Sucessfully tested so this can just be a place holder now
  return true;
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
