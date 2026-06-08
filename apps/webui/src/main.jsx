import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { BuilderBotAuthProvider } from './components/builderBotAuth.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BuilderBotAuthProvider>
      <App />
    </BuilderBotAuthProvider>
  </React.StrictMode>
);
