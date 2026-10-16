const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authRequired } = require('../middleware/auth');
const { createRateLimit } = require('../middleware/rateLimit');
const authService = require('./authService');

const router = express.Router();
const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Demasiados intentos. Espera unos minutos antes de volver a intentar.',
});

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && Buffer.byteLength(password, 'utf8') <= 72;
}

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET no configurada');
  }

  return jwt.sign(
    { id: user.id, sv: user.session_version ?? 0 },
    secret,
    { expiresIn: '7d' },
  );
}

router.post('/register', authRateLimit, async (req, res, next) => {
  try {
    const { password, role = 'cliente', vehicle_plate, fcm_token } = req.body;
    const name = String(req.body.name || '').trim();
    const phone = normalizePhone(req.body.phone);

    if (!name || !phone || !password) {
      return res.status(400).json({ error: 'Nombre, telefono y contrasena son obligatorios' });
    }

    if (!['cliente', 'conductor'].includes(role)) {
      return res.status(400).json({ error: 'Rol invalido' });
    }

    if (name.length > 120 || phone.length < 7 || phone.length > 15) {
      return res.status(400).json({ error: 'Nombre o telefono invalido' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'La contrasena debe tener entre 8 y 72 caracteres' });
    }

    const normalizedPlate = String(vehicle_plate || '').trim().toUpperCase();
    if (role === 'conductor' && !normalizedPlate) {
      return res.status(400).json({ error: 'La placa de la moto es obligatoria para conductores' });
    }
    if (normalizedPlate.length > 20) return res.status(400).json({ error: 'Placa invalida' });

    const existing = await authService.findUserByPhone(phone);
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese telefono' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await authService.registerUser({
      name,
      phone,
      passwordHash,
      role,
      vehicle_plate: normalizedPlate,
    });

    if (fcm_token) {
      await authService.updateFcmToken(user.id, fcm_token);
    }

    return res.status(201).json({ user, token: signToken(user) });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', authRateLimit, async (req, res, next) => {
  try {
    const { password, fcm_token } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!phone || !password) {
      return res.status(400).json({ error: 'Telefono y contrasena son obligatorios' });
    }

    const found = await authService.findUserByPhone(phone);
    if (!found) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const ok = await bcrypt.compare(password, found.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const user = { id: found.id, name: found.name, phone: found.phone, role: found.role, phone_verified: found.phone_verified };

    if (fcm_token) {
      await authService.updateFcmToken(user.id, fcm_token);
    }

    return res.json({ user, token: signToken(found) });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authRequired, async (req, res) => {
  const { session_version, ...user } = req.user;
  res.json({ user });
});

router.post('/logout', authRequired, async (req, res, next) => {
  try {
    await authService.revokeSessions(req.user.id);
    res.json({ updated: true });
  } catch (error) { next(error); }
});

router.patch('/push-token', authRequired, async (req, res, next) => {
  try {
    const fcmToken = String(req.body.fcm_token || '').trim();
    if (!fcmToken || fcmToken.length > 4096) {
      return res.status(400).json({ error: 'Token de notificaciones invalido' });
    }
    await authService.updateFcmToken(req.user.id, fcmToken);
    return res.json({ updated: true });
  } catch (error) {
    return next(error);
  }
});

router.patch('/password', authRequired, authRateLimit, async (req, res, next) => {
  try {
    const currentPassword = req.body.current_password;
    const newPassword = req.body.new_password;
    if (!currentPassword || !validatePassword(newPassword)) {
      return res.status(400).json({ error: 'La nueva contrasena debe tener entre 8 y 72 caracteres' });
    }

    const found = await authService.findUserByPhone(req.user.phone);
    if (!found || !(await bcrypt.compare(currentPassword, found.password_hash))) {
      return res.status(403).json({ error: 'La contrasena actual es incorrecta' });
    }

    await authService.updatePassword(req.user.id, await bcrypt.hash(newPassword, 10));
    require('../socket').disconnectUser(req.user.id);
    return res.json({ updated: true });
  } catch (error) {
    return next(error);
  }
});

router.delete('/account', authRequired, async (req, res, next) => {
  try {
    await authService.deleteOwnAccount(req.user.id);
    require('../socket').disconnectUser(req.user.id);
    return res.json({ deleted: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
