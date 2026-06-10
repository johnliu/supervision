import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initElectrobunPlatform } from './platform/electrobun';

// Install the desktop backend before React mounts: the store's module-scope
// push-handler registrations buffer in the facade and flush here.
initElectrobunPlatform();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
