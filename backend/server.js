require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./src/routes/auth');
const rideRoutes = require('./src/routes/rides');
const driverRoutes = require('./src/routes/drivers');
const adminRoutes = require('./src/routes/admin');
const socketService = require('./src/socket');
const { getPool, closePool } = require('./src/db');
const errorHandler = require('./src/middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

app.set('trust proxy', 1);
app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    const developmentFallback = process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0;
    if (!origin || developmentFallback || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origen no permitido'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use('/legal', express.static(require('node:path').join(__dirname, 'public', 'legal')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'Mototaxi Mompox API', timestamp: new Date().toISOString() });
});

app.get('/api/ready', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT TOP 0 session_version, phone_verified FROM Users; SELECT TOP 0 approval_status FROM DriverProfiles; SELECT TOP 0 id FROM AuthChallenges; SELECT TOP 0 id FROM SupportReports; SELECT TOP 0 user_id FROM DriverLocations; SELECT TOP 0 id FROM PushReceipts;');
    res.json({ ok: true, database: 'ready' });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/recovery', require('./src/routes/recovery'));
app.use('/api/operations', require('./src/routes/operations'));
app.use('/api/rides', rideRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use(errorHandler);

function startServer(port = PORT, host = HOST) {
  const server = http.createServer(app);
  socketService.init(server);

  return server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`API Mototaxi Mompox escuchando en http://${host}:${actualPort}`);
  });
}

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /generate_a_random|change_me/.test(process.env.JWT_SECRET))) {
    throw new Error('Configura un JWT_SECRET aleatorio de al menos 32 caracteres antes de iniciar produccion.');
  }
  const server = startServer();
  let checking = false;
  const receiptsTimer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try { await require('./src/notificationService').checkReceipts(); }
    catch { console.error('[Push] No se pudieron verificar recibos. Revisar servicio y migracion SQL.'); }
    finally { checking = false; }
  }, 60000);
  receiptsTimer.unref();
  const shutdown = signal => {
    clearInterval(receiptsTimer);
    console.log(`[Server] ${signal} recibido; cerrando conexiones.`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { app, startServer };
