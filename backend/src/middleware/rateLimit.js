function createRateLimit({ windowMs, max, message }) {
  const attempts = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of attempts.entries()) {
      if (value.resetAt <= now) attempts.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  cleanup.unref();

  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = attempts.get(key);

    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

module.exports = { createRateLimit };
