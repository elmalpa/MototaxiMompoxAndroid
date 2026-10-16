const express = require('express');
const { authRequired, requireRole } = require('../middleware/auth');
const rideService = require('./rideService');

const router = express.Router();

function normalizeNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

router.post('/', authRequired, requireRole('cliente'), async (req, res, next) => {
  try {
    const {
      pickup_address,
      pickup_lat,
      pickup_lng,
      destination_address,
      destination_lat,
      destination_lng,
      offered_price,
    } = req.body;

    const clean = {
      pickup_address,
      pickup_lat: normalizeNullableNumber(pickup_lat),
      pickup_lng: normalizeNullableNumber(pickup_lng),
      destination_address,
      destination_lat: normalizeNullableNumber(destination_lat),
      destination_lng: normalizeNullableNumber(destination_lng),
      offered_price: normalizeNullableNumber(offered_price),
    };

    if (!req.user.phone_verified) return res.status(403).json({ error: 'Verifica tu telefono antes de solicitar un viaje.' });
    for (const key of ['pickup_address', 'destination_address']) {
      if (typeof clean[key] !== 'string' || !clean[key].trim() || clean[key].length > 255) {
        return res.status(400).json({ error: 'Las direcciones deben tener entre 1 y 255 caracteres.' });
      }
      clean[key] = clean[key].trim();
    }
    for (const prefix of ['pickup', 'destination']) {
      const lat = clean[`${prefix}_lat`], lng = clean[`${prefix}_lng`];
      if ((lat === null) !== (lng === null) || (lat !== null && (Math.abs(lat) > 90 || Math.abs(lng) > 180))) {
        return res.status(400).json({ error: 'Coordenadas invalidas' });
      }
    }

    if (!clean.pickup_address || !clean.destination_address) {
      return res.status(400).json({ error: 'Debes indicar punto de recogida y destino' });
    }

    if (clean.offered_price === null || clean.offered_price < 3000 || clean.offered_price > 99999999) {
      return res.status(400).json({ error: 'El precio debe ser de 3000 pesos en adelante' });
    }

    const ride = await rideService.createRide(req.user.id, clean, clean.offered_price);

    res.status(201).json(ride);
  } catch (error) {
    next(error);
  }
});

router.get('/available', authRequired, requireRole('conductor'), async (req, res, next) => {
  try {
    const rides = await rideService.getAvailableRides(req.user.id);
    res.json(rides);
  } catch (error) {
    next(error);
  }
});

router.get('/my', authRequired, async (req, res, next) => {
  try {
    const rides = await rideService.getUserRides(req.user.id, req.user.role);
    res.json(rides);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/accept', authRequired, requireRole('conductor'), async (req, res, next) => {
  try {
    const rideId = Number(req.params.id);
    if (!Number.isInteger(rideId) || rideId < 1) return res.status(400).json({ error: 'ID de servicio invalido' });

    const ride = await rideService.acceptRide(rideId, req.user.id);

    if (!ride) {
      return res.status(409).json({ error: 'Este servicio ya no esta disponible' });
    }

    res.json(ride);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/offer', authRequired, requireRole('conductor'), async (req, res, next) => {
  try {
    const rideId = Number(req.params.id);
    if (!Number.isInteger(rideId) || rideId < 1) return res.status(400).json({ error: 'ID de servicio invalido' });

    const offeredPrice = normalizeNullableNumber(req.body.offered_price);
    if (offeredPrice === null || offeredPrice < 3000 || offeredPrice > 99999999) {
      return res.status(400).json({ error: 'La contraoferta debe ser de 3000 pesos en adelante' });
    }

    const ride = await rideService.offerRidePrice(rideId, req.user.id, offeredPrice);

    if (!ride) {
      return res.status(409).json({ error: 'Este servicio ya no esta disponible para ofertar' });
    }

    res.json(ride);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/client-accept', authRequired, requireRole('cliente'), async (req, res, next) => {
  try {
    const rideId = Number(req.params.id);
    if (!Number.isInteger(rideId) || rideId < 1) return res.status(400).json({ error: 'ID de servicio invalido' });

    const ride = await rideService.acceptDriverOffer(rideId, req.user.id);

    if (!ride) {
      return res.status(409).json({ error: 'No se pudo aceptar la contraoferta' });
    }

    res.json(ride);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/client-reject', authRequired, requireRole('cliente'), async (req, res, next) => {
  try {
    const rideId = Number(req.params.id);
    if (!Number.isInteger(rideId) || rideId < 1) return res.status(400).json({ error: 'ID de servicio invalido' });

    const ride = await rideService.rejectDriverOffer(rideId, req.user.id);

    if (!ride) {
      return res.status(409).json({ error: 'No se pudo rechazar la contraoferta' });
    }

    res.json(ride);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/status', authRequired, async (req, res, next) => {
  try {
    const rideId = Number(req.params.id);
    if (!Number.isInteger(rideId) || rideId < 1) return res.status(400).json({ error: 'ID de servicio invalido' });

    const { status } = req.body;
    const allowed = ['en_camino', 'finalizado', 'cancelado'];

    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Estado invalido' });
    }

    const ride = await rideService.updateRideStatus(rideId, req.user.id, status);

    if (!ride) {
      return res.status(409).json({ error: 'No se pudo actualizar el servicio' });
    }

    res.json(ride);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/rating', authRequired, requireRole('cliente'), async (req, res, next) => {
  try {
    const rideId = Number(req.params.id);
    if (!Number.isInteger(rideId) || rideId < 1) return res.status(400).json({ error: 'ID de servicio invalido' });

    const ride = await rideService.rateDriverService(
      rideId,
      req.user.id,
      req.body.rating,
      req.body.comment
    );

    if (!ride) {
      return res.status(409).json({ error: 'Solo puedes calificar una carrera finalizada' });
    }

    res.json(ride);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
