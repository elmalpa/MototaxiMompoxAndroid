require('dotenv').config({ quiet: true });
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { getPool, closePool } = require('../src/db');
(async () => {
  try {
    const pool = await getPool();
    await pool.request().batch(readFileSync(join(__dirname, '../database/production-hardening.sql'), 'utf8'));
    console.log('Migracion aplicada. Las sesiones anteriores dejan de ser validas; los conductores requieren revision.');
  } catch (error) {
    console.error('No se pudo aplicar la migracion. Revisa la conexion, permisos y que el esquema inicial exista.');
    console.error('Detalle SQL:', error.message);
    for (const detail of error.precedingErrors || []) console.error('Detalle SQL:', detail.message);
    process.exitCode = 1;
  } finally { await closePool(); }
})();
