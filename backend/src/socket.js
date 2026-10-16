const { Server } = require('socket.io');
const { authenticate } = require('./sessionService');
const { sql, getPool } = require('./db');
let io;
module.exports = {
  init(httpServer) {
    io = new Server(httpServer, { cors: { origin: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean) } });
    io.use(async (socket, next) => {
      try { socket.data.user = await authenticate(socket.handshake.auth?.token); next(); }
      catch { next(new Error('Debes iniciar sesion')); }
    });
    io.on('connection', socket => {
      const user = socket.data.user;
      socket.join(`user_${user.id}`);
      socket.on('set_availability', async () => {
        try {
          await authenticate(socket.handshake.auth?.token);
          const pool = await getPool();
          const result = await pool.request().input('id', sql.Int, user.id).query(
            "SELECT user_id FROM DriverProfiles WHERE user_id = @id AND is_available = 1 AND approval_status = 'approved'",
          );
          if (user.role === 'conductor' && user.phone_verified && result.recordset.length) socket.join('available_drivers');
          else socket.leave('available_drivers');
        } catch { socket.disconnect(true); }
      });
      const timer = setInterval(async () => {
        try { await authenticate(socket.handshake.auth?.token); }
        catch { socket.disconnect(true); }
      }, 30000);
      timer.unref();
      socket.on('disconnect', () => clearInterval(timer));
    });
    return io;
  },
  disconnectUser(id) { io?.in(`user_${id}`).disconnectSockets(true); },
  getIO() {
    if (!io) throw new Error('Socket.io no ha sido inicializado');
    return io;
  },
};
