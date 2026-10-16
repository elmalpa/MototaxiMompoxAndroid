const express = require('express');
const { randomInt, randomUUID, createHmac } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../db');
const { authRequired } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rateLimit');
const smsService = require('../smsService');
const router = express.Router();
router.use(createRateLimit({ windowMs: 900000, max: 10, message: 'Espera antes de solicitar otro codigo.' }));

function hash(id, code) {
  return createHmac('sha256', process.env.JWT_SECRET).update(`${id}:${code}`).digest('hex');
}

async function issue(user, purpose) {
  const id = randomUUID();
  if (!user) return id; // Same response for registered and unregistered phones.
  const code = String(randomInt(100000, 1000000));
  const pool = await getPool();
  await pool.request().input('id', sql.UniqueIdentifier, id).input('user', sql.Int, user.id)
    .input('purpose', sql.VarChar(12), purpose).input('hash', sql.VarChar(64), hash(id, code)).query(`
      INSERT INTO AuthChallenges (id, user_id, purpose, code_hash, expires_at)
      VALUES (@id, @user, @purpose, @hash, DATEADD(minute, 10, SYSUTCDATETIME()))
    `);
  try {
    await smsService.sendCode(user.phone, code, id);
  } catch {
    await pool.request().input('id', sql.UniqueIdentifier, id).query('UPDATE AuthChallenges SET consumed = 1 WHERE id = @id');
    // Do not disclose account existence through delivery failures.
    console.error('[SMS] No se pudo entregar un codigo. Revisar proveedor.');
  }
  return id;
}

router.use((req, res, next) => {
  if (!smsService.isConfigured()) {
    return res.status(503).json({ error: 'La verificacion por SMS aun no esta disponible. Contacta a soporte.' });
  }
  next();
});

router.post('/request-reset', async (req, res, next) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    if (phone.length < 7 || phone.length > 15) return res.status(400).json({ error: 'Telefono invalido' });
    const user = await require('./authService').findUserByPhone(phone);
    const challengeId = await issue(user, 'reset');
    res.json({ challengeId, message: 'Si la cuenta existe, recibiras un codigo.' });
  } catch (error) { next(error); }
});

router.post('/request-verification', authRequired, async (req, res, next) => {
  try { res.json({ challengeId: await issue(req.user, 'verify') }); }
  catch (error) { next(error); }
});

async function consume(req, res, next, purpose) {
  let transaction;
  try {
    const { challengeId, code, new_password } = req.body;
    if (!/^[0-9a-f-]{36}$/i.test(String(challengeId)) || !/^\d{6}$/.test(String(code))) {
      return res.status(400).json({ error: 'Codigo invalido o vencido' });
    }
    if (purpose === 'reset' && (typeof new_password !== 'string' || new_password.length < 8 || Buffer.byteLength(new_password) > 72)) {
      return res.status(400).json({ error: 'La clave debe tener minimo 8 caracteres y maximo 72 bytes.' });
    }
    const passwordHash = purpose === 'reset' ? await bcrypt.hash(new_password, 10) : null;
    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();
    const result = await transaction.request().input('id', sql.UniqueIdentifier, challengeId)
      .input('purpose', sql.VarChar(12), purpose).query(`
        SELECT user_id, code_hash FROM AuthChallenges WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @id AND purpose = @purpose AND consumed = 0 AND attempts < 5 AND expires_at > SYSUTCDATETIME()
      `);
    const challenge = result.recordset[0];
    if (!challenge || (purpose === 'verify' && challenge.user_id !== req.user.id)) {
      await transaction.rollback(); transaction = null;
      return res.status(400).json({ error: 'Codigo invalido o vencido' });
    }
    await transaction.request().input('id', sql.UniqueIdentifier, challengeId)
      .query('UPDATE AuthChallenges SET attempts = attempts + 1 WHERE id = @id');
    if (challenge.code_hash !== hash(challengeId, code)) {
      await transaction.commit(); transaction = null;
      return res.status(400).json({ error: 'Codigo invalido o vencido' });
    }
    await transaction.request().input('id', sql.Int, challenge.user_id)
      .input('hash', sql.NVarChar(255), passwordHash).query(purpose === 'verify'
        ? 'UPDATE Users SET phone_verified = 1 WHERE id = @id'
        : 'UPDATE Users SET password_hash = @hash, session_version = session_version + 1, fcm_token = NULL, phone_verified = 1 WHERE id = @id');
    await transaction.request().input('id', sql.Int, challenge.user_id).input('purpose', sql.VarChar(12), purpose)
      .query('UPDATE AuthChallenges SET consumed = 1 WHERE user_id = @id AND purpose = @purpose');
    await transaction.commit(); transaction = null;
    if (purpose === 'reset') require('../socket').disconnectUser(challenge.user_id);
    res.json({ updated: true });
  } catch (error) {
    if (transaction && !transaction._aborted) await transaction.rollback();
    next(error);
  }
}
router.post('/reset', (req, res, next) => consume(req, res, next, 'reset'));
router.post('/verify', authRequired, (req, res, next) => consume(req, res, next, 'verify'));
module.exports = router;
