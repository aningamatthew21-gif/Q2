'use strict';

let ioInstance = null;

/**
 * Initialize the global Socket.io instance
 * Called from server.js when the server starts
 */
function setIoInstance(io) {
  ioInstance = io;
  
  io.on('connection', (socket) => {
    console.log(`🔌 [WS] Client connected: ${socket.id}`);
    
    // Allow clients to join specific rooms (future proofing)
    socket.on('join_room', (room) => {
      socket.join(room);
      console.log(`🔌 [WS] Client ${socket.id} joined room: ${room}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 [WS] Client disconnected: ${socket.id}`);
    });
  });
}

/**
 * Broadcast an event to all connected clients.
 * Optional: pass a room name to broadcast only to that room.
 * 
 * @param {string} eventName - Standardized event name (e.g., 'customers:updated')
 * @param {any} data - Payload to send
 * @param {string} [room] - Optional room to target
 */
function emitToAll(eventName, data, room = null) {
  if (!ioInstance) {
    console.warn(`⚠️  [WS] Cannot emit '${eventName}' — socket.io not initialized`);
    return;
  }

  if (room) {
    ioInstance.to(room).emit(eventName, data);
  } else {
    ioInstance.emit(eventName, data);
  }
}

module.exports = {
  setIoInstance,
  emitToAll
};
