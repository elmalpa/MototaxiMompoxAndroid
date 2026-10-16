const express = require('express');
const { authRequired, requireRole } = require('../middleware/auth');
const adminService = require('./adminService');

const router = express.Router();

router.use(authRequired, requireRole('admin'));

router.patch('/drivers/:id/approval', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = req.body.status;
    if (!Number.isInteger(id) || id < 1 || !['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Datos de aprobacion invalidos' });
    }
    const { sql, getPool } = require('../db');
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id).input('status', sql.VarChar(12), status).query(`
      UPDATE DriverProfiles SET approval_status = @status,
        is_available = CASE WHEN @status = 'approved' THEN is_available ELSE 0 END
      OUTPUT INSERTED.* WHERE user_id = @id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: 'Conductor no encontrado' });
    require('../socket').disconnectUser(id);
    res.json(result.recordset[0]);
  } catch (error) { next(error); }
});

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
    require('../socket').disconnectUser(userId);
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
    require('../socket').disconnectUser(userId);
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
