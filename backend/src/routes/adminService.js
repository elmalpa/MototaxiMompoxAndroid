const { sql, getPool } = require('../db');

async function query(recordQuery) {
  const pool = await getPool();
  const result = await pool.request().query(recordQuery);
  return result.recordset;
}

async function ensureRideRatingColumns(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.RideRequests', 'driver_service_rating') IS NULL
      ALTER TABLE dbo.RideRequests ADD driver_service_rating VARCHAR(10) NULL;

    IF COL_LENGTH('dbo.RideRequests', 'driver_service_comment') IS NULL
      ALTER TABLE dbo.RideRequests ADD driver_service_comment NVARCHAR(500) NULL;

    IF COL_LENGTH('dbo.RideRequests', 'driver_service_rated_at') IS NULL
      ALTER TABLE dbo.RideRequests ADD driver_service_rated_at DATETIME2(0) NULL;
  `);
}

const adminService = {
  async getSummary() {
    const pool = await getPool();
    await ensureRideRatingColumns(pool);

    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM Users WHERE role <> 'conductor') AS users_count,
        (SELECT COUNT(*) FROM Users WHERE role = 'cliente') AS clients_count,
        (SELECT COUNT(*) FROM Users WHERE role = 'conductor') AS drivers_count,
        (SELECT COUNT(*) FROM Users WHERE role = 'admin') AS admins_count,
        (SELECT COUNT(*) FROM RideRequests) AS rides_count,
        (SELECT COUNT(*) FROM RideRequests WHERE status = 'solicitado') AS requested_rides,
        (SELECT COUNT(*) FROM RideRequests WHERE status = 'ofertado') AS offered_rides,
        (SELECT COUNT(*) FROM RideRequests WHERE status = 'aceptado') AS accepted_rides,
        (SELECT COUNT(*) FROM RideRequests WHERE status = 'en_camino') AS active_rides,
        (SELECT COUNT(*) FROM RideRequests WHERE status = 'finalizado') AS finished_rides,
        (SELECT COUNT(*) FROM RideRequests WHERE status = 'cancelado') AS canceled_rides,
        (SELECT COUNT(*) FROM RideRequests WHERE driver_service_rating IS NOT NULL) AS rated_rides,
        (SELECT COUNT(*) FROM RideRequests WHERE driver_service_rating = 'malo') AS bad_rated_rides
    `);
    return result.recordset[0];
  },

  async getUsers() {
    return query(`
      SELECT id, name, phone, role, created_at,
             CASE WHEN fcm_token IS NULL THEN 0 ELSE 1 END AS has_fcm_token
      FROM Users
      WHERE role <> 'conductor'
      ORDER BY created_at DESC, id DESC
    `);
  },

  async getDrivers() {
    return query(`
      SELECT u.id, u.name, u.phone, u.created_at,
             dp.vehicle_plate, dp.is_available, dp.rating
      FROM Users u
      INNER JOIN DriverProfiles dp ON dp.user_id = u.id
      ORDER BY dp.is_available DESC, u.name ASC
    `);
  },

  async getRides() {
    const pool = await getPool();
    await ensureRideRatingColumns(pool);

    const result = await pool.request().query(`
      SELECT r.*,
             c.name AS client_name, c.phone AS client_phone,
             d.name AS driver_name, d.phone AS driver_phone,
             dp.vehicle_plate
      FROM RideRequests r
      INNER JOIN Users c ON c.id = r.client_id
      LEFT JOIN Users d ON d.id = r.driver_id
      LEFT JOIN DriverProfiles dp ON dp.user_id = d.id
      ORDER BY r.created_at DESC, r.id DESC
    `);
    return result.recordset;
  },

  async getTables() {
    const pool = await getPool();
    const tables = await pool.request().query(`
      SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);

    return tables.recordset;
  },

  async deleteUser(userId, currentAdminId) {
    if (userId === currentAdminId) {
      const error = new Error('No puedes eliminar tu propio usuario administrador');
      error.status = 400;
      throw error;
    }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const userResult = await transaction.request()
        .input('id', sql.Int, userId)
        .query(`
          SELECT id, role
          FROM Users
          WHERE id = @id
        `);

      const user = userResult.recordset[0];
      if (!user) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

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
      return { deleted: true, id: userId, role: user.role };
    } catch (err) {
      if (transaction._aborted === false) {
        await transaction.rollback();
      }
      throw err;
    }
  },
};

module.exports = adminService;
