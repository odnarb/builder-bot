import React, { createContext, useEffect, useState, useRef } from 'react';

const RETRY_LIMIT = 100

export const WebSocketContext = createContext({ messages: [], sendMessage: () => {} });

export default function WebSocketProvider({ children }) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const reconnectAttempts = useRef(0);

  const [messages, setMessages] = useState([]);

  const connectWebSocket = function () {
    const socket = new WebSocket("ws://localhost:3001");
    socketRef.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      reconnectAttempts.current = 0; // Reset attempts on successful connection
      console.log("✅ WebSocket connected");
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("📨 WS message:", msg);
        setMessages(prev => [...prev, msg]);
      } catch (err) {
        console.warn("⚠️ Invalid WS data:", event.data);
      }
    };

    socket.onerror = (err) => {
      console.error("❌ WebSocket error:", err);
    };

    socket.onclose = () => {
      setIsConnected(false);
      console.warn("🔌 WebSocket disconnected. Attempting to reconnect...");
      if (reconnectAttempts.current < RETRY_LIMIT) { // Limit retry attempts
        reconnectAttempts.current++;
        setTimeout(connectWebSocket, 1000 * reconnectAttempts.current); // Exponential backoff
      } else {
        console.error('❌ Max reconnection attempts reached... Refresh the page');
        alert(`Connection to BuilderBot disrupted and retry limit reached, please try reloading the page.`)
      }
    };

    return () => socket.close();
  }
  
  useEffect(() => {
    connectWebSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);


  const sendMessage = (data) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
    }
  };

  return (
    <WebSocketContext.Provider value={{ messages, sendMessage }}>
      {children}
    </WebSocketContext.Provider>
  );
}
