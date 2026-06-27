const { sql, getPool } = require('./db');
const socketService = require('./socket');
const notificationService = require('./notificationService');

/**
 * Servicio para manejar la lógica de negocio y persistencia de los viajes (rides).
 */
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
    
    // Notificar a todos los conductores conectados que hay un nuevo viaje
    socketService.getIO().emit('new_ride', ride);

    // Notificar vía Push a los conductores disponibles (App en segundo plano)
    notificationService.notifyAvailableDrivers(
      '¡Nuevo viaje disponible!',
      `Recogida en: ${ride.pickup_address}`,
      { rideId: ride.id }
    );
    
    return ride;
  },

  /**
   * Obtiene todos los viajes en estado 'solicitado'.
   */
  async getAvailableRides() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT r.*, u.name AS client_name, u.phone AS client_phone
      FROM RideRequests r
      INNER JOIN Users u ON u.id = r.client_id
      WHERE r.status = 'solicitado'
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
               d.name AS driver_name, d.phone AS driver_phone, dp.vehicle_plate
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
    const result = await pool.request()
      .input('ride_id', sql.Int, rideId)
      .input('driver_id', sql.Int, driverId)
      .query(`
        UPDATE RideRequests
        SET driver_id = @driver_id, status = 'aceptado', accepted_at = SYSUTCDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @ride_id AND status = 'solicitado'
      `);
    
    const ride = result.recordset[0];
    if (ride) {
      // Notificar al cliente específico que su viaje fue aceptado
      socketService.getIO().to(`user_${ride.client_id}`).emit('ride_accepted', ride);

      // Notificar vía Push al cliente
      notificationService.sendToUser(
        ride.client_id,
        '¡Tu Mototaxi va en camino!',
        'Un conductor ha aceptado tu solicitud.',
        { rideId: ride.id }
      );
    }
    
    return ride;
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
        WHERE id = @ride_id AND (client_id = @user_id OR driver_id = @user_id) AND status IN ('solicitado','aceptado','en_camino')
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

    const ride = result.recordset[0];
    if (ride) {
      // Notificar a ambas partes del cambio de estado
      const io = socketService.getIO();
      io.to(`user_${ride.client_id}`).emit('status_update', ride);
      if (ride.driver_id) io.to(`user_${ride.driver_id}`).emit('status_update', ride);
    }

    return ride;
  }
};

module.exports = rideService;
