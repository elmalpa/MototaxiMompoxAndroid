const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'security_test_secret_at_least_32_characters';
process.env.NODE_ENV = 'test';
const users = new Map([
  [1, { id: 1, name: 'Cliente', phone: '3001234567', role: 'cliente', session_version: 0, phone_verified: false }],
  [2, { id: 2, name: 'Conductor', phone: '3007654321', role: 'conductor', session_version: 0, phone_verified: true }],
]);
const db = require('../src/db');
db.getPool = async () => ({ request() {
  const inputs = {};
  return {
    input(key, type, value) { inputs[key] = value; return this; },
    async query(text) {
      if (text.includes('FROM Users WHERE id = @id')) return { recordset: users.has(inputs.id) ? [{ ...users.get(inputs.id) }] : [] };
      throw new Error('Unexpected database query in security test');
    },
  };
} });
const { startServer } = require('../server');
const sockets = require('../src/socket');
let server, base;
const token = id => jwt.sign({ id, sv: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
before(async () => {
  server = startServer(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => sockets.getIO().close(resolve));
});
async function request(path, id = 1, method = 'GET', body) {
  return fetch(base + path, { method, headers: { Authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
}
test('sessions use the current database role and do not expose session version', async () => {
  const forgedRole = jwt.sign({ id: 1, sv: 0, role: 'admin' }, process.env.JWT_SECRET);
  const response = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${forgedRole}` } });
  const { user } = await response.json();
  assert.equal(user.role, 'cliente');
  assert.equal(user.session_version, undefined);
});
test('changed session version invalidates a previously issued token', async () => {
  users.get(1).session_version++;
  assert.equal((await request('/api/auth/me')).status, 401);
  users.get(1).session_version = 0;
});
test('deleted users cannot keep using their token', async () => {
  const user = users.get(1); users.delete(1);
  assert.equal((await request('/api/auth/me')).status, 401);
  users.set(1, user);
});
test('unverified customers cannot request rides', async () => {
  assert.equal((await request('/api/rides', 1, 'POST', { pickup_address: 'A', destination_address: 'B', offered_price: 3000 })).status, 403);
});
test('clients cannot approve drivers or read all support reports', async () => {
  assert.equal((await request('/api/admin/drivers/2/approval', 1, 'PATCH', { status: 'approved' })).status, 403);
  assert.equal((await request('/api/operations/reports')).status, 403);
});
test('driver location rejects coordinates outside earth bounds', async () => {
  assert.equal((await request('/api/operations/location', 2, 'PUT', { latitude: 91, longitude: 0 })).status, 400);
});
test('recovery fails explicitly when no SMS provider is configured', async () => {
  const previous = process.env.SMS_WEBHOOK_URL;
  const provider = process.env.SMS_PROVIDER;
  process.env.SMS_PROVIDER = 'webhook';
  delete process.env.SMS_WEBHOOK_URL;
  const response = await fetch(base + '/api/recovery/request-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '3001234567' }) });
  assert.equal(response.status, 503);
  if (previous) process.env.SMS_WEBHOOK_URL = previous;
  if (provider) process.env.SMS_PROVIDER = provider;
  else delete process.env.SMS_PROVIDER;
});
async function connect(auth) {
  const open = await (await fetch(base + '/socket.io/?EIO=4&transport=polling')).text();
  const { sid } = JSON.parse(open.slice(1));
  const url = `${base}/socket.io/?EIO=4&transport=polling&sid=${sid}`;
  await fetch(url, { method: 'POST', body: '40' + JSON.stringify(auth || {}) });
  const frame = await (await fetch(url)).text();
  return { url, frame };
}
test('socket connections require authentication', async () => {
  const { url, frame } = await connect();
  assert.match(frame, /44.*Debes iniciar sesion/);
  await fetch(url, { method: 'POST', body: '1' });
});
test('authenticated sockets cannot join another users private room', async () => {
  const { url, frame } = await connect({ token: token(1) });
  assert.match(frame, /^40/);
  await fetch(url, { method: 'POST', body: '42["join",999]' });
  assert.equal(sockets.getIO().sockets.adapter.rooms.has('user_999'), false);
  assert.equal(sockets.getIO().sockets.adapter.rooms.has('user_1'), true);
  sockets.disconnectUser(1);
  assert.equal(sockets.getIO().sockets.adapter.rooms.has('user_1'), false);
});
