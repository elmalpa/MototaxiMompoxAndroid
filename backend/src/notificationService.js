const { sql, getPool } = require('./db');

async function sendExpoNotifications(tokens, title, body, data) {
  if (tokens.length === 0) return;

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tokens.map(to => ({
      to,
      sound: 'default',
      title,
      body,
      data,
      channelId: 'viajes',
    }))),
  });

  if (!response.ok) {
    throw new Error(`Expo Push respondio ${response.status}`);
  }
}

async function sendNotifications(tokens, title, body, data = {}) {
  const normalizedData = { ...data, rideId: String(data.rideId || '') };
  const expoTokens = tokens.filter(token => /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token));
  await sendExpoNotifications(expoTokens, title, body, normalizedData);
}

const notificationService = {
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
        WHERE dp.is_available = 1 AND u.fcm_token IS NOT NULL
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
