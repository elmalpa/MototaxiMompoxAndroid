const { sql, getPool } = require('../db');

const driverService = {
  /**
   * Obtiene el perfil completo del conductor por su ID de usuario.
   */
  async getProfile(userId) {
    const pool = await getPool();
    const result = await pool.request()
      .input('user_id', sql.Int, userId)
      .query(`
        SELECT u.id, u.name, u.phone, u.phone_verified, dp.vehicle_plate, dp.is_available, dp.rating, dp.approval_status
        FROM Users u
        INNER JOIN DriverProfiles dp ON dp.user_id = u.id
        WHERE u.id = @user_id
      `);
    return result.recordset[0];
  },

  /**
   * Actualiza el estado de disponibilidad del conductor.
   */
  async updateAvailability(userId, isAvailable) {
    const pool = await getPool();
    const result = await pool.request()
      .input('user_id', sql.Int, userId)
      .input('is_available', sql.Bit, isAvailable ? 1 : 0)
      .query(`
        UPDATE DriverProfiles
        SET is_available = @is_available
        OUTPUT INSERTED.*
        WHERE user_id = @user_id
          AND (@is_available = 0 OR (approval_status = 'approved' AND EXISTS (
            SELECT 1 FROM Users WHERE id = @user_id AND phone_verified = 1
          )))
      `);
    return result.recordset[0];
  }
};

module.exports = driverService;
