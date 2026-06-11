import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initElectrobunPlatform } from './platform/electrobun';

// Install the desktop backend before React mounts: the store's module-scope
// push-handler registrations buffer in the facade and flush here.
initElectrobunPlatform();

// Desktop-only styling hook: with the hiddenInset titlebar the traffic lights
// float over the content, so the sidebar pads down to clear them (web mode
// has no native chrome and keeps the tight layout).
document.documentElement.classList.add('platform-desktop');

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
