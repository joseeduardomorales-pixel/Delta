import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { setupServiceWorkerReload } from './lib/swReload.js';
import './index.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Delta: #root element not found in index.html');
}

// Register the service worker and wire up auto-reload on new-version-detected.
// This is what stops users from staring at stale builds after a deploy.
setupServiceWorkerReload();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
