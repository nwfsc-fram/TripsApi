import * as oracledb from 'oracledb';

const vmsOleConfig = require('../dbConfig.json').vmsOleConfig;

export async function getFishTicket(ftid: string): Promise<string[]> {
    let fishTicketRows: any = [];

    try {
      const pool = getOraclePool();
      const connection = await pool.getConnection();
      const result = await connection.execute(
        `SELECT PACFIN_SPECIES_CODE, LANDED_WEIGHT_LBS, CONDITION_CODE, VESSEL_NUM
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

export async function fakeDBTest() {
  // Sucessfully tested so this can just be a place holder now
  return true;
}

function closeOracleConnection(connection: any) {
    console.log('Closing oracledb connection.');
    connection.close();
}

function getOraclePool() {
    const pool = oracledb.getPool();
    console.log(
        'Connect to pool ' +
        pool.poolAlias +
        ', pool connections open: ' +
        pool.connectionsOpen
    );
    return pool;
}
