const { Server } = require('socket.io');

let io;

const socketService = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: '*', // Ajustar en producción por seguridad
      }
    });

    io.on('connection', (socket) => {
      console.log(`[Socket] Nuevo cliente conectado: ${socket.id}`);

      // Permitir que el usuario se una a una "sala" privada basada en su ID
      socket.on('join', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`[Socket] Usuario ${userId} se unió a su sala privada`);
      });

      // Gestionar la entrada/salida de la sala de conductores disponibles
      socket.on('set_availability', (isAvailable) => {
        if (isAvailable) {
          socket.join('available_drivers');
          console.log(`[Socket] Socket ${socket.id} unido a conductores disponibles`);
        } else {
          socket.leave('available_drivers');
          console.log(`[Socket] Socket ${socket.id} salió de conductores disponibles`);
        }
      });

      socket.on('disconnect', () => {
        console.log('[Socket] Cliente desconectado');
      });
    });

    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io no ha sido inicializado');
    }
    return io;
  },
};

module.exports = socketService;