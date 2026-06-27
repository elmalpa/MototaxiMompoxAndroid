const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

process.env.JWT_SECRET = 'automated_test_secret_with_at_least_32_chars';
process.env.NODE_ENV = 'test';

const { startServer } = require('../server');

let server;
let baseUrl;

before(async () => {
  server = startServer(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('health check responds without exposing secrets', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.app, 'Mototaxi Mompox API');
  assert.equal(JSON.stringify(body).includes(process.env.JWT_SECRET), false);
});

test('protected account routes reject missing authentication', async () => {
  const response = await fetch(`${baseUrl}/api/auth/account`, { method: 'DELETE' });
  assert.equal(response.status, 401);
});

test('protected account routes reject invalid tokens', async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: 'Bearer token-invalido' },
  });
  assert.equal(response.status, 401);
});

test('unknown routes return JSON 404', async () => {
  const response = await fetch(`${baseUrl}/ruta-que-no-existe`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error, 'Ruta no encontrada');
});
