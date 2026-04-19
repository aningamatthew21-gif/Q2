import { io } from 'socket.io-client';

// The Vite proxy configuration automatically routes /socket.io requests
// to the backend server running on port 3001. So we can connect to '/' natively.
// We configure it to only use websockets (avoiding long-polling fallbacks) for performance.

const socket = io('/', {
  transports: ['websocket'],
  autoConnect: false, // We connect manually when needed
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity
});

// Event listeners for debugging and UI state logic
socket.on('connect', () => {
  console.log('🟢 [WS] Connected to backend WebSocket server', socket.id);
});

socket.on('disconnect', (reason) => {
  console.warn(`🔴 [WS] Disconnected from backend WebSocket server. Reason: ${reason}`);
});

socket.on('connect_error', (error) => {
  console.error('❌ [WS] Connection error:', error.message);
});

export default socket;
