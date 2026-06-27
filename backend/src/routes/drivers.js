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
    const updated = await driverService.updateAvailability(req.user.id, is_available);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
