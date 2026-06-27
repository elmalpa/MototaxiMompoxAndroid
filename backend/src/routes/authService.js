const { sql, getPool } = require('../db');

const authService = {
  /**
   * Busca un usuario por su número de teléfono.
   */
  async findUserByPhone(phone) {
    const pool = await getPool();
    const result = await pool.request()
      .input('phone', sql.VarChar(30), phone)
      .query('SELECT id, name, phone, password_hash, role FROM Users WHERE phone = @phone');
    return result.recordset[0];
  },

  /**
   * Registra un nuevo usuario y su perfil de conductor si aplica.
   * Usa una transacción para asegurar la integridad de los datos.
   */
  async registerUser({ name, phone, passwordHash, role, vehicle_plate }) {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const result = await transaction.request()
        .input('name', sql.NVarChar(120), name)
        .input('phone', sql.VarChar(30), phone)
        .input('password_hash', sql.NVarChar(255), passwordHash)
        .input('role', sql.VarChar(20), role)
        .query(`
          INSERT INTO Users (name, phone, password_hash, role)
          OUTPUT INSERTED.id, INSERTED.name, INSERTED.phone, INSERTED.role
          VALUES (@name, @phone, @password_hash, @role)
        `);

      const user = result.recordset[0];

      if (role === 'conductor') {
        await transaction.request()
          .input('user_id', sql.Int, user.id)
          .input('vehicle_plate', sql.VarChar(20), vehicle_plate)
          .query(`
            INSERT INTO DriverProfiles (user_id, vehicle_plate, is_available, rating)
            VALUES (@user_id, @vehicle_plate, 1, 5.0)
          `);
      }

      await transaction.commit();
      return user;
    } catch (err) {
      if (transaction._aborted === false) {
        await transaction.rollback();
      }
      throw err;
    }
  },

  /**
   * Actualiza el token de Firebase Cloud Messaging para un usuario.
   */
  async updateFcmToken(userId, fcmToken) {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, userId)
      .input('fcm_token', sql.NVarChar(sql.MAX), fcmToken)
      .query(`
        UPDATE Users SET fcm_token = @fcm_token WHERE id = @id
      `);
  },

  async updatePassword(userId, passwordHash) {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, userId)
      .input('password_hash', sql.NVarChar(255), passwordHash)
      .query('UPDATE Users SET password_hash = @password_hash WHERE id = @id');
  },

  async deleteOwnAccount(userId) {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      await transaction.request()
        .input('id', sql.Int, userId)
        .query(`
          IF OBJECT_ID(N'dbo.RideRejectedDrivers', N'U') IS NOT NULL
          BEGIN
            DELETE FROM RideRejectedDrivers
            WHERE driver_id = @id
               OR ride_id IN (SELECT id FROM RideRequests WHERE client_id = @id);
          END;

          UPDATE RideRequests
          SET driver_id = NULL
          WHERE driver_id = @id;

          DELETE FROM RideRequests
          WHERE client_id = @id;

          DELETE FROM DriverProfiles
          WHERE user_id = @id;

          DELETE FROM Users
          WHERE id = @id;
        `);

      await transaction.commit();
      return { deleted: true };
    } catch (error) {
      if (transaction._aborted === false) {
        await transaction.rollback();
      }
      throw error;
    }
  }
};

module.exports = authService;
