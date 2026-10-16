const { authenticate } = require('../sessionService');

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Debes iniciar sesión' });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(503).json({ error: 'El servidor no tiene configurada la autenticacion' });
    }
    req.user = await authenticate(token);
    return next();
  } catch (error) {
    if (!['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name) && error.status !== 401) {
      return next(error);
    }
    return res.status(401).json({ error: 'Sesión inválida o vencida' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    return next();
  };
}

module.exports = { authRequired, requireRole };
