require('dotenv').config({ quiet: true });
const sms = require('../src/smsService');

(async () => {
  if (process.env.SMS_PROVIDER !== 'smsgate' || !sms.isConfigured()) {
    console.error('Configuracion SMSGate incompleta. Ejecuta el configurador local.');
    process.exitCode = 1;
    return;
  }
  try {
    const base = (process.env.SMSGATE_URL || 'https://api.sms-gate.app/3rdparty/v1').replace(/\/+$/, '');
    const response = await fetch(`${base}/devices`, {
      headers: { Authorization: `Basic ${Buffer.from(`${process.env.SMSGATE_USERNAME}:${process.env.SMSGATE_PASSWORD}`).toString('base64')}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error(`SMSGate respondio HTTP ${response.status}. Revisa las credenciales y el servicio.`);
      process.exitCode = 1;
      return;
    }
    const devices = await response.json();
    if (!Array.isArray(devices)) throw new Error('Invalid response');
    let device = devices.find(item => item.id === process.env.SMSGATE_DEVICE_ID);
    if (!device && process.argv.includes('--repair-device') && devices.length === 1 && /^[A-Za-z0-9_-]+$/.test(devices[0].id)) {
      const fs = require('node:fs');
      const path = require('node:path').join(__dirname, '../.env');
      const content = fs.readFileSync(path, 'utf8');
      const replacement = `SMSGATE_DEVICE_ID='${devices[0].id}'`;
      const pattern = /^\s*(?:export\s+)?SMSGATE_DEVICE_ID\s*=.*$/gm;
      const updated = pattern.test(content) ? content.replace(pattern, () => replacement) : `${content}\n${replacement}\n`;
      fs.writeFileSync(path, updated, 'utf8');
      device = devices[0];
      console.log('La cuenta tiene un unico Android. Device ID corregido en backend/.env.');
    }
    if (!device) {
      console.error('Autenticacion correcta, pero el Device ID configurado no figura en esta cuenta. Copialo otra vez desde Cloud server.');
      process.exitCode = 1;
      return;
    }
    console.log('Autenticacion SMSGate correcta. Android configurado encontrado.');
    console.log(`Ranura elegida: ${Number(process.env.SMSGATE_SIM_NUMBER || '1')}. No se enviaron SMS.`);
  } catch {
    console.error('No se pudo comprobar SMSGate. Revisa internet y vuelve a intentar. No se enviaron SMS.');
    process.exitCode = 1;
  }
})();
