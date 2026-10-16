function isHttps(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function isConfigured() {
  if (process.env.SMS_PROVIDER === 'smsgate') {
    return Boolean(isHttps(process.env.SMSGATE_URL || 'https://api.sms-gate.app/3rdparty/v1')
      && process.env.SMSGATE_USERNAME && process.env.SMSGATE_PASSWORD
      && process.env.SMSGATE_DEVICE_ID
      && /^[1-3]$/.test(process.env.SMSGATE_SIM_NUMBER || '1'));
  }
  if (process.env.SMS_PROVIDER && process.env.SMS_PROVIDER !== 'webhook') return false;
  return Boolean(isHttps(process.env.SMS_WEBHOOK_URL) && process.env.SMS_WEBHOOK_SECRET);
}

function colombianMobile(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(digits)) return `+57${digits}`;
  if (/^573\d{9}$/.test(digits)) return `+${digits}`;
  throw new Error('Numero movil colombiano invalido');
}

async function sendCode(phone, code, challengeId) {
  if (!isConfigured()) throw new Error('SMS no configurado');
  const message = `Mototaxi Mompox: tu codigo es ${code}. Vence en 10 minutos.`;
  let url = process.env.SMS_WEBHOOK_URL;
  let authorization = `Bearer ${process.env.SMS_WEBHOOK_SECRET}`;
  let body = { to: phone, message };
  if (process.env.SMS_PROVIDER === 'smsgate') {
    url = `${(process.env.SMSGATE_URL || 'https://api.sms-gate.app/3rdparty/v1').replace(/\/+$/, '')}/messages`;
    authorization = `Basic ${Buffer.from(`${process.env.SMSGATE_USERNAME}:${process.env.SMSGATE_PASSWORD}`).toString('base64')}`;
    body = {
      id: challengeId,
      textMessage: { text: message },
      phoneNumbers: [colombianMobile(phone)],
      deviceId: process.env.SMSGATE_DEVICE_ID,
      simNumber: Number(process.env.SMSGATE_SIM_NUMBER || '1'),
      ttl: 600,
      withDeliveryReport: true,
    };
  }
  const response = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('El puente SMS no acepto el mensaje');
  // A queued message is not proof of delivery. Never log message bodies or credentials.
  if (process.env.SMS_PROVIDER === 'smsgate') {
    const result = await response.json();
    if (!result.id || ['Failed', 'Cancelled'].includes(result.state)) throw new Error('El puente SMS rechazo el mensaje');
  }
}
module.exports = { isConfigured, colombianMobile, sendCode };
