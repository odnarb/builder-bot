import React, { createContext, useEffect, useRef, useState } from 'react';

const RETRY_LIMIT = 100;

export const WebSocketContext = createContext({
  messages: [],
  sendMessage: () => { },
});

export default function WebSocketProvider({ children }) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const shouldReconnect = useRef(true);
  const [messages, setMessages] = useState([]);

  const connectWebSocket = () => {
    const socket = new WebSocket('ws://localhost:3002');
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('✅ WebSocket connected');
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('📨 WS message:', msg);
        setMessages(prev => [...prev, msg]);
      } catch (err) {
        console.warn('⚠️ Invalid WS data:', event.data);
      }
    };

    socket.onerror = (err) => {
      console.error('❌ WebSocket error:', err);
    };

    socket.onclose = (event) => {
      setIsConnected(false);
      console.warn('🔌 WebSocket disconnected.');

      // ⛔ Only reconnect if still allowed and socket is current
      if (
        shouldReconnect.current &&
        socket === socketRef.current &&
        reconnectAttempts.current < RETRY_LIMIT
      ) {
        reconnectAttempts.current++;
        const delay = 1000 * reconnectAttempts.current;
        console.log(`🔁 Reconnecting in ${delay / 1000}s...`);
        setTimeout(connectWebSocket, delay);
      } else if (reconnectAttempts.current >= RETRY_LIMIT) {
        console.error('❌ Max reconnection attempts reached.');
        alert('Connection to BuilderBot lost. Please reload the page.');
      }
    };
  };

  useEffect(() => {
    shouldReconnect.current = true;
    connectWebSocket();

    return () => {
      shouldReconnect.current = false;
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  const sendMessage = (data) => {
    if (
      socketRef.current &&
      socketRef.current.readyState === WebSocket.OPEN
    ) {
      socketRef.current.send(JSON.stringify(data));
    }
  };

  return (
    <WebSocketContext.Provider value={{ messages, sendMessage }}>
      {children}
    </WebSocketContext.Provider>
  );
}
