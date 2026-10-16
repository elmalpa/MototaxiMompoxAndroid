const jwt = require('jsonwebtoken');
const { sql, getPool } = require('./db');

async function authenticate(token) {
  const claims = jwt.verify(token, process.env.JWT_SECRET);
  const pool = await getPool();
  const result = await pool.request().input('id', sql.Int, claims.id).query(
    'SELECT id, name, phone, role, phone_verified, session_version FROM Users WHERE id = @id',
  );
  const user = result.recordset[0];
  if (!user || claims.sv !== user.session_version) {
    const error = new Error('Sesion invalida o vencida');
    error.status = 401;
    throw error;
  }
  return user;
}

module.exports = { authenticate };
