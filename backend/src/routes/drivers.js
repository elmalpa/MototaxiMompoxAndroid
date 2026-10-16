const express = require('express');
const { authRequired, requireRole } = require('../middleware/auth');
const driverService = require('./driverService');

const router = express.Router();

router.get('/me', authRequired, requireRole('conductor'), async (req, res, next) => {
  try {
    const profile = await driverService.getProfile(req.user.id);
    if (!profile) {
      return res.status(404).json({ error: 'Perfil de conductor no encontrado' });
    }
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

router.patch('/availability', authRequired, requireRole('conductor'), async (req, res, next) => {
  try {
    const { is_available } = req.body;
    if (typeof is_available !== 'boolean') return res.status(400).json({ error: 'Disponibilidad invalida' });
    const updated = await driverService.updateAvailability(req.user.id, is_available);
    if (!updated) return res.status(403).json({ error: 'Verifica tu telefono y espera la aprobacion del administrador.' });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
