const express = require('express');
const { sql, getPool } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rateLimit');
const router = express.Router();
router.use(authRequired);
router.use(createRateLimit({ windowMs: 60000, max: 60, message: 'Demasiadas solicitudes. Intenta nuevamente.' }));

router.post('/reports', async (req, res, next) => {
  try {
    const message = String(req.body.message || '').trim();
    const rideId = req.body.ride_id == null ? null : Number(req.body.ride_id);
    if (message.length < 5 || message.length > 2000 || (rideId !== null && (!Number.isInteger(rideId) || rideId < 1))) {
      return res.status(400).json({ error: 'Escribe entre 5 y 2000 caracteres y un viaje valido.' });
    }
    const pool = await getPool();
    if (rideId) {
      const ride = await pool.request().input('id', sql.Int, rideId).input('user', sql.Int, req.user.id)
        .query('SELECT id FROM RideRequests WHERE id = @id AND (client_id = @user OR driver_id = @user)');
      if (!ride.recordset.length) return res.status(404).json({ error: 'Viaje no encontrado' });
    }
    const result = await pool.request().input('user', sql.Int, req.user.id).input('ride', sql.Int, rideId)
      .input('message', sql.NVarChar(2000), message).query(`
        INSERT INTO SupportReports (user_id, ride_id, message) OUTPUT INSERTED.id, INSERTED.status VALUES (@user, @ride, @message)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (error) { next(error); }
});

router.get('/reports', requireRole('admin'), async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 200 r.*, u.name, u.phone FROM SupportReports r LEFT JOIN Users u ON u.id = r.user_id
      ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created_at DESC
    `);
    res.json(result.recordset);
  } catch (error) { next(error); }
});

router.patch('/reports/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || !['open', 'resolved'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Reporte invalido' });
    }
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id).input('status', sql.VarChar(12), req.body.status)
      .query('UPDATE SupportReports SET status = @status OUTPUT INSERTED.id WHERE id = @id');
    if (!result.recordset.length) return res.status(404).json({ error: 'Reporte no encontrado' });
    res.json({ updated: true });
  } catch (error) { next(error); }
});

router.put('/location', requireRole('conductor'), async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return res.status(400).json({ error: 'Ubicacion invalida' });
    }
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, req.user.id).input('lat', sql.Decimal(9, 6), latitude)
      .input('lng', sql.Decimal(9, 6), longitude).query(`
        MERGE DriverLocations WITH (HOLDLOCK) AS target
        USING (SELECT @id AS user_id FROM DriverProfiles dp
          WHERE dp.user_id = @id AND dp.approval_status = 'approved' AND EXISTS (
            SELECT 1 FROM RideRequests WHERE driver_id = @id AND status IN ('aceptado','en_camino')
          )) AS source ON target.user_id = source.user_id
        WHEN MATCHED THEN UPDATE SET latitude = @lat, longitude = @lng, updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (user_id, latitude, longitude) VALUES (@id, @lat, @lng)
        OUTPUT INSERTED.user_id;
      `);
    if (!result.recordset.length) return res.status(403).json({ error: 'No tienes un viaje activo para compartir ubicacion.' });
    res.json({ updated: true });
  } catch (error) { next(error); }
});

router.get('/rides/:id/location', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Viaje invalido' });
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id).input('user', sql.Int, req.user.id).query(`
      SELECT l.latitude, l.longitude, l.updated_at FROM DriverLocations l
      INNER JOIN RideRequests r ON r.driver_id = l.user_id
      WHERE r.id = @id AND (r.client_id = @user OR r.driver_id = @user)
        AND r.status IN ('aceptado','en_camino') AND l.updated_at > DATEADD(second, -60, SYSUTCDATETIME())
        AND l.updated_at >= r.accepted_at
    `);
    if (!result.recordset.length) return res.status(404).json({ error: 'Ubicacion reciente no disponible' });
    res.json(result.recordset[0]);
  } catch (error) { next(error); }
});
module.exports = router;
