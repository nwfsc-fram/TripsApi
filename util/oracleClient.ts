import * as oracledb from 'oracledb';

export enum database {
  PACFIN = 'pacfin',
  OBSPROD = 'obsProd',
  VMS = 'vms'
}
export class OracleHelper {
    connection: any;
    poolAlias: string;

    constructor(user: string, password: string, connectString: string, poolAlias: string) {
        this.poolAlias = poolAlias;
        console.log('Creating oracle connection pool to', ODWdbConfig.connectString);
        const oracleCredentials = {
          user,
          password,
          connectString,
          poolAlias
        };
        oracledb.fetchAsString = [ oracledb.CLOB ];
      
        oracledb.createPool(oracleCredentials, function(err, pool) {
          if (pool) {
            console.log('Oracle connection pool created:', pool.poolAlias); // 'default'
          } else {
            console.log(err);
          }
        });
    }

    async getConnection() {
        oracledb.autoCommit = true;
        const pool = oracledb.getPool(this.poolAlias);
        console.log(
            'Connect to pool ' +
            pool.poolAlias + 
            ', pool connections open: ' +
            pool.connectionsOpen
        );
        this.connection = await pool.getConnection();
        return this.connection;
    }

    async getData(query: string, params: any[]) {
      let result;
      try {
        const connection = await this.getConnection();
        result = await connection.execute(query, params);
      } catch(error) {
        console.log(error);
      }
      this.closeConnection();
      return result;
    }

    closeConnection() {
        console.log('Closing oracledb connection');
        this.connection.close();
    }
}

const ODWdbConfig = require('../dbConfig.json').ODWdbConfig;
const OBSPRODdbConfig = require('../dbConfig.json').OBSPRODdbConfig;
const VMSConfig = require('../dbConfig.json').VMSConfig;

export const pacfinPool = new OracleHelper(ODWdbConfig.user, ODWdbConfig.password, ODWdbConfig.connectString, 'pacfin');
export const obsProdPool = new OracleHelper(OBSPRODdbConfig.user, OBSPRODdbConfig.password, OBSPRODdbConfig.connectString, 'obsprod');
export const vmsPool = new OracleHelper(VMSConfig.user, VMSConfig.password, VMSConfig.connectString, 'vms');
