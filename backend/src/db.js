const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: Number.parseInt(process.env.DB_PORT, 10) || 1433,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
  },
};

let pool;
let poolPromise;

function validateConfig() {
  const required = ['DB_USER', 'DB_PASSWORD', 'DB_SERVER', 'DB_DATABASE'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Faltan variables de base de datos: ${missing.join(', ')}`);
  }
}

async function getPool() {
  if (pool?.connected) {
    return pool;
  }

  if (!poolPromise) {
    validateConfig();
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then(connectedPool => {
        pool = connectedPool;
        console.log('[DB] Conectado exitosamente a SQL Server');
        return connectedPool;
      })
      .catch(err => {
        poolPromise = null;
        console.error('[DB] Error al conectar a SQL Server:', err.message);
        throw err;
      });
  }

  return poolPromise;
}

async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
    poolPromise = null;
  }
}

module.exports = {
  sql,
  getPool,
  closePool,
};
