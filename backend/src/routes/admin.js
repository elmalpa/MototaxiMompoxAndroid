const express = require('express');
const { authRequired, requireRole } = require('../middleware/auth');
const adminService = require('./adminService');

const router = express.Router();

router.use(authRequired, requireRole('admin'));

router.get('/summary', async (req, res, next) => {
  try {
    res.json(await adminService.getSummary());
  } catch (error) {
    next(error);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    res.json(await adminService.getUsers());
  } catch (error) {
    next(error);
  }
});

router.delete('/users/:id', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Id de usuario invalido' });
    }

    res.json(await adminService.deleteUser(userId, req.user.id));
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/delete', async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Id de usuario invalido' });
    }

    res.json(await adminService.deleteUser(userId, req.user.id));
  } catch (error) {
    next(error);
  }
});

router.get('/drivers', async (req, res, next) => {
  try {
    res.json(await adminService.getDrivers());
  } catch (error) {
    next(error);
  }
});

router.get('/rides', async (req, res, next) => {
  try {
    res.json(await adminService.getRides());
  } catch (error) {
    next(error);
  }
});

router.get('/tables', async (req, res, next) => {
  try {
    res.json(await adminService.getTables());
  } catch (error) {
    next(error);
  }
});

module.exports = router;
