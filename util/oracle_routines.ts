import * as oracledb from 'oracledb';

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
  // Right now this function is to test where this call will come from
  const vmsOleConfig =  {
    "user": "squishy",
    "password": "squid",
    "connectString": "www.google.com:1555/SCHEMA"
      } 
  let readConnection: any;
  try {
    readConnection = await oracledb.getConnection(vmsOleConfig);
    const result = await readConnection.execute(
      'SELECT * FROM fake_table'
    );
    return result;
  } catch (err) {
      console.error(err);
  } finally {
    try {
      await readConnection.close();
    } catch (err) {
        console.error(err);
    }
  }
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
