const assert = require('node:assert/strict');
const { test } = require('node:test');
test('SQL: SMS verification and recovery expire, limit attempts and consume codes once', { skip: process.env.RUN_SQL_TESTS !== 'true', timeout: 60000 }, async () => {
  require('dotenv').config({ quiet: true });
  process.env.JWT_SECRET = 'isolated_recovery_test_secret_at_least_32_characters';
  process.env.SMS_PROVIDER = 'webhook';
  process.env.SMS_WEBHOOK_URL = 'https://sms.test.invalid/send';
  process.env.SMS_WEBHOOK_SECRET = 'test-only';
  const realFetch = global.fetch;
  let code, server, userId;
  global.fetch = async (url, options) => {
    if (url === process.env.SMS_WEBHOOK_URL) {
      code = JSON.parse(options.body).message.match(/\b\d{6}\b/)[0];
      return new Response('{}', { status: 200 });
    }
    return realFetch(url, options);
  };
  const { sql, getPool, closePool } = require('../src/db');
  const bcrypt = require('bcryptjs');
  const pool = await getPool();
  const phone = '999' + String(require('node:crypto').randomInt(100000000000, 999999999999));
  try {
    const result = await pool.request().input('phone', sql.VarChar(30), phone).input('hash', sql.NVarChar(255), await bcrypt.hash('Initial-test-123', 10))
      .query("INSERT INTO Users (name, phone, password_hash, role) OUTPUT INSERTED.id VALUES ('__recovery_test__', @phone, @hash, 'cliente')");
    userId = result.recordset[0].id;
    server = require('../server').startServer(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function post(path, body, token) {
      return realFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    }
    const login = await (await post('/api/auth/login', { phone, password: 'Initial-test-123' })).json();
    assert.ok(login.token);
    const verification = await (await post('/api/recovery/request-verification', {}, login.token)).json();
    assert.equal((await post('/api/recovery/verify', { challengeId: verification.challengeId, code }, login.token)).status, 200);
    assert.equal((await post('/api/recovery/verify', { challengeId: verification.challengeId, code }, login.token)).status, 400);
    const expired = await (await post('/api/recovery/request-reset', { phone })).json();
    await pool.request().input('id', sql.UniqueIdentifier, expired.challengeId).query('UPDATE AuthChallenges SET expires_at = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE id = @id');
    assert.equal((await post('/api/recovery/reset', { challengeId: expired.challengeId, code, new_password: 'Changed-test-123' })).status, 400);
    const limited = await (await post('/api/recovery/request-reset', { phone })).json();
    await pool.request().input('id', sql.UniqueIdentifier, limited.challengeId).query('UPDATE AuthChallenges SET attempts = 5 WHERE id = @id');
    assert.equal((await post('/api/recovery/reset', { challengeId: limited.challengeId, code, new_password: 'Changed-test-123' })).status, 400);
    const reset = await (await post('/api/recovery/request-reset', { phone })).json();
    const body = { challengeId: reset.challengeId, code, new_password: 'Changed-test-123' };
    assert.equal((await post('/api/recovery/reset', body)).status, 200);
    assert.equal((await post('/api/recovery/reset', body)).status, 400);
    const oldSession = await realFetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${login.token}` } });
    assert.equal(oldSession.status, 401);
    assert.equal((await post('/api/auth/login', { phone, password: 'Changed-test-123' })).status, 200);
  } finally {
    global.fetch = realFetch;
    if (server) await new Promise(resolve => require('../src/socket').getIO().close(resolve));
    if (userId) await pool.request().input('id', sql.Int, userId).query('DELETE FROM Users WHERE id = @id');
    await closePool();
  }
});
