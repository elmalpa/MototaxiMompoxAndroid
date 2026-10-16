const { sql, getPool } = require('./db');

async function clearToken(token) {
  const pool = await getPool();
  await pool.request().input('token', sql.NVarChar(sql.MAX), token)
    .query('UPDATE Users SET fcm_token = NULL WHERE fcm_token = @token');
}

async function sendExpoNotifications(tokens, title, body, data) {
  const pool = await getPool();
  for (let offset = 0; offset < tokens.length; offset += 100) {
    const chunk = tokens.slice(offset, offset + 100);
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk.map(to => ({ to, sound: 'default', title, body, data, channelId: 'viajes' }))),
    });
    if (!response.ok) throw new Error(`Expo Push respondio ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.data)) throw new Error('Respuesta de Expo Push invalida');
    for (const [index, ticket] of result.data.entries()) {
      if (ticket.status === 'error') {
        if (ticket.details?.error === 'DeviceNotRegistered') await clearToken(chunk[index]);
        console.error('[Push] Error de entrega:', ticket.details?.error || 'unknown');
      } else if (ticket.id) {
        await pool.request().input('id', sql.VarChar(100), ticket.id).input('token', sql.NVarChar(sql.MAX), chunk[index])
          .query('INSERT INTO PushReceipts (id, token) VALUES (@id, @token)');
      }
    }
  }
}

async function sendNotifications(tokens, title, body, data = {}) {
  const normalizedData = { ...data, rideId: String(data.rideId || '') };
  const expoTokens = tokens.filter(token => /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token));
  await sendExpoNotifications(expoTokens, title, body, normalizedData);
}

const notificationService = {
  async checkReceipts() {
    const pool = await getPool();
    await pool.request().query("DELETE FROM AuthChallenges WHERE expires_at < DATEADD(day, -1, SYSUTCDATETIME()); DELETE FROM DriverLocations WHERE updated_at < DATEADD(day, -1, SYSUTCDATETIME()); DELETE FROM PushReceipts WHERE created_at < DATEADD(day, -1, SYSUTCDATETIME());");
    const pending = await pool.request().query("SELECT TOP 100 id, token FROM PushReceipts WHERE created_at < DATEADD(minute, -15, SYSUTCDATETIME()) ORDER BY created_at");
    if (!pending.recordset.length) return;
    const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: pending.recordset.map(row => row.id) }),
    });
    if (!response.ok) throw new Error('No se pudieron consultar recibos de notificaciones');
    const result = await response.json();
    for (const row of pending.recordset) {
      const receipt = result.data?.[row.id];
      if (!receipt) continue;
      if (receipt.details?.error === 'DeviceNotRegistered') await clearToken(row.token);
      if (receipt.status === 'error') console.error('[Push] Error en recibo:', receipt.details?.error || 'unknown');
      await pool.request().input('id', sql.VarChar(100), row.id).query('DELETE FROM PushReceipts WHERE id = @id');
    }
    await pool.request().query("DELETE FROM PushReceipts WHERE created_at < DATEADD(day, -1, SYSUTCDATETIME())");
  },
  async sendToUser(userId, title, body, data = {}) {
    try {
      const pool = await getPool();
      const result = await pool.request()
        .input('userId', sql.Int, userId)
        .query('SELECT fcm_token FROM Users WHERE id = @userId AND fcm_token IS NOT NULL');

      const token = result.recordset[0]?.fcm_token;
      if (token) {
        await sendNotifications([token], title, body, data);
      }
    } catch (error) {
      console.error('Error enviando notificacion push:', error.message);
    }
  },

  async notifyAvailableDrivers(title, body, data = {}) {
    try {
      const pool = await getPool();
      const result = await pool.request().query(`
        SELECT u.fcm_token FROM Users u
        INNER JOIN DriverProfiles dp ON dp.user_id = u.id
        WHERE dp.is_available = 1 AND dp.approval_status = 'approved' AND u.phone_verified = 1 AND u.fcm_token IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM RideRequests WHERE driver_id = u.id AND status IN ('ofertado','aceptado','en_camino'))
      `);

      const tokens = result.recordset.map(record => record.fcm_token);
      if (tokens.length > 0) {
        await sendNotifications(tokens, title, body, data);
      }
    } catch (error) {
      console.error('Error enviando notificacion push masiva:', error.message);
    }
  },
};

module.exports = notificationService;
