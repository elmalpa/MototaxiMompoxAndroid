require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
const sms = require('../src/smsService');
const keys = ['SMS_PROVIDER', 'SMSGATE_URL', 'SMSGATE_USERNAME', 'SMSGATE_PASSWORD', 'SMSGATE_DEVICE_ID', 'SMSGATE_SIM_NUMBER'];
const expectedUrl = 'https://mototaximompoxandroid.onrender.com';

async function request(path, options = {}) {
  const response = await fetch(`https://api.render.com/v1${path}`, {
    ...options, signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, 'Content-Type': 'application/json' },
  });
  if (response.status === 401) throw new Error('Render rechazo la API Key (HTTP 401). Genera una clave nueva en Account Settings > API Keys y copia el valor completo.');
  if (!response.ok) throw new Error(`Render respondio HTTP ${response.status}. No se muestran detalles privados.`);
  return response.json();
}

async function main() {
  if (!process.env.RENDER_API_KEY) throw new Error('Usa configure-render-sms.ps1 para introducir la clave de forma privada.');
  if (process.env.SMS_PROVIDER !== 'smsgate' || !sms.isConfigured()) throw new Error('Completa primero la configuracion local de SMSGate.');
  let cursor;
  let service;
  do {
    const page = await request(`/services?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!Array.isArray(page)) throw new Error('Render devolvio una lista inesperada.');
    const matches = page.map(item => item.service).filter(item => item?.serviceDetails?.url?.replace(/\/+$/, '') === expectedUrl);
    if (matches.length > 1 || (service && matches.length)) throw new Error('Destino ambiguo. No se modifico el servicio.');
    service = matches[0] || service;
    const next = page.length === 100 ? page[page.length - 1]?.cursor : null;
    if (next === cursor) throw new Error('No se pudo completar la lista de servicios.');
    cursor = next;
  } while (cursor);
  if (!service || service.type !== 'web_service') throw new Error('No se encontro el backend esperado en esta cuenta Render.');
  console.log(`Destino comprobado: ${expectedUrl}`);
  // Update individual keys; never replace SQL, JWT or other unrelated variables.
  const values = Object.fromEntries(keys.map(key => [key, process.env[key] || (key === 'SMSGATE_URL' ? 'https://api.sms-gate.app/3rdparty/v1' : key === 'SMSGATE_SIM_NUMBER' ? '1' : '')]));
  // Select the provider last, once the other fields have been saved.
  for (const key of [...keys.filter(key => key !== 'SMS_PROVIDER'), 'SMS_PROVIDER']) {
    await request(`/services/${encodeURIComponent(service.id)}/env-vars/${key}`, { method: 'PUT', body: JSON.stringify({ value: values[key] }) });
    console.log(`${key}: guardada.`);
  }
  for (const key of keys) {
    const saved = await request(`/services/${encodeURIComponent(service.id)}/env-vars/${key}`);
    if (saved.value !== values[key]) throw new Error(`No se pudo verificar ${key}. Revisa el panel privado.`);
  }
  console.log('Las seis variables SMS se guardaron y verificaron en Render. No se enviaron SMS.');
  console.log('Falta desplegar el backend actualizado para aplicar la configuracion.');
}
main().catch(error => { console.error(error.message.startsWith('Render respondio') || !error.cause ? error.message : 'No se pudo conectar con Render.'); process.exitCode = 1; });
