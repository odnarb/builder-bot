import React, { createContext, useEffect, useRef, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

const RETRY_LIMIT = 100;

export const WebSocketContext = createContext({
  messages: [],
  isConnected: false,
  sendMessage: () => { },
});

export default function WebSocketProvider({ children }) {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const shouldReconnect = useRef(true);
  const [messages, setMessages] = useState([]);

  const connectWebSocket = async () => {
    let accessToken = '';
    try {
      accessToken = await getAccessTokenSilently();
    } catch (error) {
      console.error('❌ Could not fetch access token for WebSocket auth:', error);
      if (shouldReconnect.current && reconnectAttempts.current < RETRY_LIMIT) {
        reconnectAttempts.current++;
        const delay = 1000 * reconnectAttempts.current;
        setTimeout(() => {
          void connectWebSocket();
        }, delay);
      }
      return;
    }

    const socketUrl = `ws://127.0.0.1:3002?authToken=${encodeURIComponent(accessToken)}`;
    const socket = new WebSocket(socketUrl);
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
        setTimeout(() => {
          void connectWebSocket();
        }, delay);
      } else if (reconnectAttempts.current >= RETRY_LIMIT) {
        console.error('❌ Max reconnection attempts reached.');
        alert('Connection to BuilderBot lost. Please reload the page.');
      }
    };
  };

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }

    shouldReconnect.current = true;
    void connectWebSocket();

    return () => {
      shouldReconnect.current = false;
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [isAuthenticated, getAccessTokenSilently]);

  const sendMessage = (data) => {
    if (
      socketRef.current &&
      socketRef.current.readyState === WebSocket.OPEN
    ) {
      socketRef.current.send(JSON.stringify(data));
    }
  };

  return (
    <WebSocketContext.Provider value={{ messages, isConnected, sendMessage }}>
      {children}
    </WebSocketContext.Provider>
  );
}
