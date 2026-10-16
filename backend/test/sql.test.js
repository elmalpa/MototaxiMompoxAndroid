const assert = require('node:assert/strict');
const { test } = require('node:test');
require('dotenv').config({ quiet: true });

test('SQL: concurrent assignments, rejection and rating persistence', { skip: process.env.RUN_SQL_TESTS !== 'true', timeout: 60000 }, async () => {
  const { sql, getPool, closePool } = require('../src/db');
  const notifications = require('../src/notificationService');
  notifications.sendToUser = async () => {};
  notifications.notifyAvailableDrivers = async () => {};
  require('../src/socket').getIO = () => ({ to() { return this; }, emit() {} });
  const service = require('../src/routes/rideService');
  const pool = await getPool();
  const ids = [], rides = [];
  async function user(role) {
    const phone = 't' + require('node:crypto').randomBytes(10).toString('hex');
    const result = await pool.request().input('phone', sql.VarChar(30), phone).input('role', sql.VarChar(20), role).query(`
      INSERT INTO Users (name, phone, password_hash, role, phone_verified)
      OUTPUT INSERTED.id VALUES ('__automated_test__', @phone, 'not-a-login-hash', @role, 1)
    `);
    const id = result.recordset[0].id; ids.push(id);
    if (role === 'conductor') await pool.request().input('id', sql.Int, id).query(
      "INSERT INTO DriverProfiles (user_id, vehicle_plate, is_available, rating, approval_status) VALUES (@id, 'TEST', 1, 5, 'approved')",
    );
    return id;
  }
  async function ride(client) {
    const result = await pool.request().input('client', sql.Int, client).query(`
      INSERT INTO RideRequests (client_id, pickup_address, destination_address, estimated_price)
      OUTPUT INSERTED.id VALUES (@client, 'Test origen', 'Test destino', 3000)
    `);
    const id = result.recordset[0].id; rides.push(id); return id;
  }
  try {
    const c = await user('cliente'), d1 = await user('conductor'), d2 = await user('conductor');
    const r1 = await ride(c), r2 = await ride(c);
    const sameDriver = await Promise.allSettled([service.acceptRide(r1, d1), service.acceptRide(r2, d1)]);
    assert.equal(sameDriver.filter(result => result.status === 'fulfilled' && result.value).length, 1);
    assert.equal(sameDriver.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
    const accepted = sameDriver.find(result => result.status === 'fulfilled').value;
    await service.updateRideStatus(accepted.id, d1, 'finalizado');
    await service.rateDriverService(accepted.id, c, 'regular', '');
    assert.equal(await service.rateDriverService(accepted.id, c, 'bueno', ''), null);
    const rating = await pool.request().input('id', sql.Int, d1).query('SELECT rating FROM DriverProfiles WHERE user_id = @id');
    assert.equal(Number(rating.recordset[0].rating), 3);
    const r3 = await ride(c);
    const sameRide = await Promise.all([service.acceptRide(r3, d1), service.acceptRide(r3, d2)]);
    assert.equal(sameRide.filter(Boolean).length, 1);
    const assigned = sameRide.find(Boolean);
    await service.updateRideStatus(r3, assigned.driver_id, 'cancelado');
    const r4 = await ride(c);
    await service.offerRidePrice(r4, d1, 4000);
    await service.rejectDriverOffer(r4, c);
    assert.equal(await service.acceptRide(r4, d1), null);
    assert.equal((await service.acceptRide(r4, d2)).driver_id, d2);
  } finally {
    for (const id of rides) {
      await pool.request().input('id', sql.Int, id).query('DELETE FROM RideRejectedDrivers WHERE ride_id = @id; DELETE FROM RideRequests WHERE id = @id;');
    }
    for (const id of ids) {
      await pool.request().input('id', sql.Int, id).query('DELETE FROM DriverProfiles WHERE user_id = @id; DELETE FROM Users WHERE id = @id;');
    }
    await closePool();
  }
});
