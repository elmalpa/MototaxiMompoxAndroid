const { sql, getPool } = require('../db');
const socketService = require('../socket');
const notificationService = require('../notificationService');

/**
 * Servicio para manejar la lógica de negocio y persistencia de los viajes (rides).
 */
async function hydrateRide(pool, rideId) {
  const result = await pool.request()
    .input('ride_id', sql.Int, rideId)
    .query(`
      SELECT r.*, c.name AS client_name, c.phone AS client_phone,
             d.name AS driver_name, d.phone AS driver_phone,
             dp.vehicle_plate, dp.is_available AS driver_is_available,
             dp.rating AS driver_rating
      FROM RideRequests r
      INNER JOIN Users c ON c.id = r.client_id
      LEFT JOIN Users d ON d.id = r.driver_id
      LEFT JOIN DriverProfiles dp ON dp.user_id = d.id
      WHERE r.id = @ride_id
    `);

  return result.recordset[0];
}

async function ensureRejectedDriversTable(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.RideRejectedDrivers', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.RideRejectedDrivers (
        ride_id INT NOT NULL,
        driver_id INT NOT NULL,
        rejected_at DATETIME2(0) NOT NULL CONSTRAINT DF_RideRejectedDrivers_rejected_at DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_RideRejectedDrivers PRIMARY KEY (ride_id, driver_id),
        CONSTRAINT FK_RideRejectedDrivers_RideRequests FOREIGN KEY (ride_id) REFERENCES dbo.RideRequests(id),
        CONSTRAINT FK_RideRejectedDrivers_Users FOREIGN KEY (driver_id) REFERENCES dbo.Users(id)
      );
    END;
  `);
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

async function getActiveDriverRide(pool, driverId) {
  const result = await pool.request()
    .input('driver_id', sql.Int, driverId)
    .query(`
      SELECT TOP 1 id, status, pickup_address, destination_address
      FROM RideRequests
      WHERE driver_id = @driver_id
        AND status IN ('ofertado', 'aceptado', 'en_camino')
      ORDER BY accepted_at DESC, created_at DESC
    `);

  return result.recordset[0] || null;
}

function assertDriverCanTakeRide(activeRide) {
  if (!activeRide) return;

  const error = new Error('No puedes aceptar otra carrera hasta finalizar la que tienes activa.');
  error.status = 409;
  error.code = 'DRIVER_HAS_ACTIVE_RIDE';
  error.activeRide = activeRide;
  throw error;
}

const rideService = {
  /**
   * Crea una nueva solicitud de viaje.
   */
  async createRide(clientId, pickupData, estimatedPrice) {
    const pool = await getPool();
    const result = await pool.request()
      .input('client_id', sql.Int, clientId)
      .input('pickup_address', sql.NVarChar(255), pickupData.pickup_address)
      .input('pickup_lat', sql.Decimal(9, 6), pickupData.pickup_lat)
      .input('pickup_lng', sql.Decimal(9, 6), pickupData.pickup_lng)
      .input('destination_address', sql.NVarChar(255), pickupData.destination_address)
      .input('destination_lat', sql.Decimal(9, 6), pickupData.destination_lat)
      .input('destination_lng', sql.Decimal(9, 6), pickupData.destination_lng)
      .input('estimated_price', sql.Decimal(10, 2), estimatedPrice)
      .query(`
        INSERT INTO RideRequests (
          client_id, pickup_address, pickup_lat, pickup_lng,
          destination_address, destination_lat, destination_lng,
          estimated_price, status
        )
        OUTPUT INSERTED.*
        VALUES (
          @client_id, @pickup_address, @pickup_lat, @pickup_lng,
          @destination_address, @destination_lat, @destination_lng,
          @estimated_price, 'solicitado'
        )
      `);
    
    const ride = result.recordset[0];
    
    // Notificar a conductores en tiempo real
    socketService.getIO().to('available_drivers').emit('new_ride', ride);
    notificationService.notifyAvailableDrivers(
      '¡Nuevo viaje!', 
      `Recogida en: ${ride.pickup_address}`, 
      { rideId: ride.id }
    );

    return ride;
  },

  /**
   * Obtiene todos los viajes en estado 'solicitado'.
   */
  async getAvailableRides(driverId) {
    const pool = await getPool();
    await ensureRejectedDriversTable(pool);

    const result = await pool.request()
      .input('driver_id', sql.Int, driverId)
      .query(`
      SELECT r.*, u.name AS client_name, u.phone AS client_phone
      FROM RideRequests r
      INNER JOIN Users u ON u.id = r.client_id
      WHERE r.status = 'solicitado'
        AND NOT EXISTS (
          SELECT 1
          FROM RideRejectedDrivers rrd
          WHERE rrd.ride_id = r.id
            AND rrd.driver_id = @driver_id
        )
      ORDER BY r.created_at DESC
    `);
    return result.recordset;
  },

  /**
   * Obtiene los viajes asociados a un usuario según su rol.
   */
  async getUserRides(userId, role) {
    const pool = await getPool();
    const filterField = role === 'conductor' ? 'r.driver_id' : 'r.client_id';

    const result = await pool.request()
      .input('user_id', sql.Int, userId)
      .query(`
        SELECT r.*, c.name AS client_name, c.phone AS client_phone,
               d.name AS driver_name, d.phone AS driver_phone,
               dp.vehicle_plate, dp.is_available AS driver_is_available,
               dp.rating AS driver_rating
        FROM RideRequests r
        INNER JOIN Users c ON c.id = r.client_id
        LEFT JOIN Users d ON d.id = r.driver_id
        LEFT JOIN DriverProfiles dp ON dp.user_id = d.id
        WHERE ${filterField} = @user_id
        ORDER BY r.created_at DESC
      `);
    return result.recordset;
  },

  /**
   * Asigna un conductor a un viaje.
   */
  async acceptRide(rideId, driverId) {
    const pool = await getPool();
    const activeRide = await getActiveDriverRide(pool, driverId);
    assertDriverCanTakeRide(activeRide);

    const result = await pool.request()
      .input('ride_id', sql.Int, rideId)
      .input('driver_id', sql.Int, driverId)
      .query(`
        UPDATE RideRequests
        SET driver_id = @driver_id, status = 'aceptado', accepted_at = SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @ride_id AND status = 'solicitado'
      `);
    
    const changedRide = result.recordset[0];
    const ride = changedRide ? await hydrateRide(pool, changedRide.id) : null;
    if (ride) {
      socketService.getIO().to(`user_${ride.client_id}`).emit('ride_accepted', ride);
      notificationService.sendToUser(ride.client_id, 'Viaje Aceptado', 'Tu conductor va en camino.', { rideId: ride.id });
    }
    return ride;
  },

  /**
   * Permite que un conductor proponga un precio distinto al cliente.
   */
  async offerRidePrice(rideId, driverId, offeredPrice) {
    const pool = await getPool();
    const activeRide = await getActiveDriverRide(pool, driverId);
    assertDriverCanTakeRide(activeRide);

    const result = await pool.request()
      .input('ride_id', sql.Int, rideId)
      .input('driver_id', sql.Int, driverId)
      .input('driver_offer_price', sql.Decimal(10, 2), offeredPrice)
      .query(`
        UPDATE RideRequests
        SET driver_id = @driver_id,
            driver_offer_price = @driver_offer_price,
            status = 'ofertado'
        OUTPUT INSERTED.*
        WHERE id = @ride_id AND status = 'solicitado'
      `);

    const changedRide = result.recordset[0];
    const ride = changedRide ? await hydrateRide(pool, changedRide.id) : null;
    if (ride) {
      socketService.getIO().to(`user_${ride.client_id}`).emit('ride_offer', ride);
      notificationService.sendToUser(
        ride.client_id,
        'Nueva contraoferta',
        `Un conductor propuso $${Number(ride.driver_offer_price).toLocaleString('es-CO')}.`,
        { rideId: ride.id }
      );
    }
    return ride;
  },

  /**
   * El cliente acepta la contraoferta del conductor.
   */
  async acceptDriverOffer(rideId, clientId) {
    const pool = await getPool();
    const result = await pool.request()
      .input('ride_id', sql.Int, rideId)
      .input('client_id', sql.Int, clientId)
      .query(`
        UPDATE RideRequests
        SET estimated_price = driver_offer_price,
            status = 'aceptado',
            client_accepted_at = SYSUTCDATETIME(),
            accepted_at = SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @ride_id
          AND client_id = @client_id
          AND status = 'ofertado'
          AND driver_id IS NOT NULL
          AND driver_offer_price IS NOT NULL
      `);

    const changedRide = result.recordset[0];
    const ride = changedRide ? await hydrateRide(pool, changedRide.id) : null;
    if (ride) {
      const io = socketService.getIO();
      io.to(`user_${ride.client_id}`).emit('ride_accepted', ride);
      io.to(`user_${ride.driver_id}`).emit('ride_offer_accepted', ride);
      notificationService.sendToUser(ride.driver_id, 'Contraoferta aceptada', 'El cliente acepto tu precio.', { rideId: ride.id });
    }
    return ride;
  },

  /**
   * El cliente rechaza la contraoferta y deja el viaje disponible para otros conductores.
   */
  async rejectDriverOffer(rideId, clientId) {
    const pool = await getPool();
    await ensureRejectedDriversTable(pool);

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const currentResult = await transaction.request()
        .input('ride_id', sql.Int, rideId)
        .input('client_id', sql.Int, clientId)
        .query(`
          SELECT id, driver_id
          FROM RideRequests
          WHERE id = @ride_id
            AND client_id = @client_id
            AND status = 'ofertado'
            AND driver_id IS NOT NULL
            AND driver_offer_price IS NOT NULL
        `);

      const currentRide = currentResult.recordset[0];
      if (!currentRide) {
        await transaction.rollback();
        return null;
      }

      await transaction.request()
        .input('ride_id', sql.Int, rideId)
        .input('driver_id', sql.Int, currentRide.driver_id)
        .query(`
          IF NOT EXISTS (
            SELECT 1
            FROM RideRejectedDrivers
            WHERE ride_id = @ride_id AND driver_id = @driver_id
          )
          BEGIN
            INSERT INTO RideRejectedDrivers (ride_id, driver_id)
            VALUES (@ride_id, @driver_id);
          END;
        `);

      const updateResult = await transaction.request()
        .input('ride_id', sql.Int, rideId)
        .input('client_id', sql.Int, clientId)
        .query(`
          UPDATE RideRequests
          SET driver_id = NULL,
              driver_offer_price = NULL,
              status = 'solicitado',
              accepted_at = NULL,
              client_accepted_at = NULL
          OUTPUT INSERTED.*
          WHERE id = @ride_id
            AND client_id = @client_id
            AND status = 'ofertado'
        `);

      await transaction.commit();

      const changedRide = updateResult.recordset[0];
      const ride = changedRide ? await hydrateRide(pool, changedRide.id) : null;
      if (ride) {
        const io = socketService.getIO();
        io.to(`user_${ride.client_id}`).emit('ride_offer_rejected', ride);
        io.to(`user_${currentRide.driver_id}`).emit('ride_offer_rejected', { id: ride.id });
        notificationService.sendToUser(
          currentRide.driver_id,
          'Contraoferta rechazada',
          'El cliente decidio esperar otro conductor.',
          { rideId: ride.id }
        );
      }
      return ride;
    } catch (err) {
      if (transaction._aborted === false) {
        await transaction.rollback();
      }
      throw err;
    }
  },

  /**
   * Actualiza el estado de un viaje aplicando las reglas de negocio.
   */
  async updateRideStatus(rideId, userId, status) {
    const pool = await getPool();
    let query;

    if (status === 'cancelado') {
      query = `
        UPDATE RideRequests
        SET status = 'cancelado'
        OUTPUT INSERTED.*
        WHERE id = @ride_id AND (client_id = @user_id OR driver_id = @user_id) AND status IN ('solicitado','ofertado','aceptado','en_camino')
      `;
    } else if (status === 'finalizado') {
      query = `
        UPDATE RideRequests
        SET status = 'finalizado', finished_at = SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @ride_id AND driver_id = @user_id AND status IN ('aceptado','en_camino')
      `;
    } else {
      query = `
        UPDATE RideRequests
        SET status = 'en_camino'
        OUTPUT INSERTED.*
        WHERE id = @ride_id AND driver_id = @user_id AND status = 'aceptado'
      `;
    }

    const result = await pool.request()
      .input('ride_id', sql.Int, rideId)
      .input('user_id', sql.Int, userId)
      .query(query);

    const changedRide = result.recordset[0];
    const ride = changedRide ? await hydrateRide(pool, changedRide.id) : null;
    if (ride) {
      const io = socketService.getIO();
      io.to(`user_${ride.client_id}`).emit('status_update', ride);
      if (ride.driver_id) io.to(`user_${ride.driver_id}`).emit('status_update', ride);
    }
    return ride;
  },

  /**
   * Guarda la calificacion del cliente sobre el servicio del conductor.
   */
  async rateDriverService(rideId, clientId, rating, comment) {
    const pool = await getPool();
    await ensureRideRatingColumns(pool);

    const cleanRating = String(rating || '').trim().toLowerCase();
    const cleanComment = String(comment || '').trim();

    if (!['bueno', 'regular', 'malo'].includes(cleanRating)) {
      const error = new Error('Calificacion invalida');
      error.status = 400;
      throw error;
    }

    if (cleanRating === 'malo' && cleanComment.length < 3) {
      const error = new Error('Debes escribir el motivo cuando calificas como malo');
      error.status = 400;
      throw error;
    }

    const result = await pool.request()
      .input('ride_id', sql.Int, rideId)
      .input('client_id', sql.Int, clientId)
      .input('driver_service_rating', sql.VarChar(10), cleanRating)
      .input('driver_service_comment', sql.NVarChar(500), cleanRating === 'malo' ? cleanComment.slice(0, 500) : null)
      .query(`
        UPDATE RideRequests
        SET driver_service_rating = @driver_service_rating,
            driver_service_comment = @driver_service_comment,
            driver_service_rated_at = SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @ride_id
          AND client_id = @client_id
          AND status = 'finalizado'
          AND driver_id IS NOT NULL
      `);

    const changedRide = result.recordset[0];
    return changedRide ? await hydrateRide(pool, changedRide.id) : null;
  }
};

module.exports = rideService;
