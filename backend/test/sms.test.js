const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const sms = require('../src/smsService');
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
function configure() {
  process.env.SMS_PROVIDER = 'smsgate';
  process.env.SMSGATE_URL = 'https://sms.test.invalid/3rdparty/v1/';
  process.env.SMSGATE_USERNAME = 'test-user';
  process.env.SMSGATE_PASSWORD = 'test-secret';
  process.env.SMSGATE_DEVICE_ID = 'test-device';
  process.env.SMSGATE_SIM_NUMBER = '2';
}
test('normalizes Colombian mobile numbers without inventing foreign destinations', () => {
  assert.equal(sms.colombianMobile('300 123 4567'), '+573001234567');
  assert.equal(sms.colombianMobile('+57 3001234567'), '+573001234567');
  assert.throws(() => sms.colombianMobile('+1 9162255887'));
  assert.throws(() => sms.colombianMobile('123'));
});
test('sends an expiring code only through the configured Android and SIM', async () => {
  configure();
  let call;
  global.fetch = async (url, options) => {
    call = { url, ...options };
    return new Response(JSON.stringify({ id: 'challenge-test', state: 'Pending' }), { status: 202 });
  };
  assert.equal(sms.isConfigured(), true);
  await sms.sendCode('3001234567', '123456', 'challenge-test');
  assert.equal(call.url, 'https://sms.test.invalid/3rdparty/v1/messages');
  assert.equal(call.headers.Authorization, `Basic ${Buffer.from('test-user:test-secret').toString('base64')}`);
  const body = JSON.parse(call.body);
  assert.deepEqual(body.phoneNumbers, ['+573001234567']);
  assert.equal(body.deviceId, 'test-device');
  assert.equal(body.simNumber, 2);
  assert.equal(body.ttl, 600);
  assert.equal(body.id, 'challenge-test');
});
test('rejects missing device, invalid SIM and insecure endpoints before sending', async () => {
  configure();
  global.fetch = () => assert.fail('No network request expected');
  delete process.env.SMSGATE_DEVICE_ID;
  assert.equal(sms.isConfigured(), false);
  await assert.rejects(sms.sendCode('3001234567', '123456', 'id'));
  configure(); process.env.SMSGATE_SIM_NUMBER = '0';
  assert.equal(sms.isConfigured(), false);
  configure(); process.env.SMSGATE_URL = 'http://example.invalid';
  assert.equal(sms.isConfigured(), false);
});
test('gateway failures are rejected without exposing provider responses or retrying', async () => {
  configure(); let calls = 0;
  global.fetch = async () => { calls++; return new Response('private provider details', { status: 401 }); };
  await assert.rejects(sms.sendCode('3001234567', '123456', 'id'), /no acepto/);
  assert.equal(calls, 1);
  global.fetch = async () => new Response(JSON.stringify({ id: 'id', state: 'Failed' }), { status: 200 });
  await assert.rejects(sms.sendCode('3001234567', '123456', 'id'), /rechazo/);
});
test('keeps the existing webhook integration working', async () => {
  process.env.SMS_PROVIDER = 'webhook';
  process.env.SMS_WEBHOOK_URL = 'https://webhook.test.invalid/send';
  process.env.SMS_WEBHOOK_SECRET = 'test';
  global.fetch = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test');
    assert.equal(JSON.parse(options.body).to, '3001234567');
    return new Response('{}', { status: 200 });
  };
  await sms.sendCode('3001234567', '123456', 'id');
});
