const { sql, getPool } = require('./db');

// Serialize assignments for one driver across all API instances.
async function withDriverLock(driverId, action) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await transaction.request().input('id', sql.Int, driverId).query(`
      SELECT dp.user_id FROM DriverProfiles dp WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN Users u ON u.id = dp.user_id
      WHERE dp.user_id = @id AND dp.approval_status = 'approved'
        AND dp.is_available = 1 AND u.phone_verified = 1
    `);
    if (!result.recordset.length) {
      throw Object.assign(new Error('Debes verificar tu telefono, tener aprobacion y activar disponibilidad.'), { status: 403 });
    }
    const value = await action(transaction);
    await transaction.commit();
    return value;
  } catch (error) {
    if (!transaction._aborted) await transaction.rollback();
    throw error;
  }
}
module.exports = { withDriverLock };
