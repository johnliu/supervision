// Web-mode entry (web.html): the real app in a plain browser. No Electrobun —
// the platform backend is either in-memory fixtures (default; deterministic,
// what Playwright drives) or the live WebSocket bridge to the Bun handlers
// (?backend=live, real repo). Test hooks install before render so no nav log
// or state transition is missed.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import App from '../App';
import { setPlatform } from '../platform';
import { useReviewStore } from '../store';
import { createFixtureBackend } from './backend';
import { getFixture } from './fixtures';
import { parseWebParams } from './params';
import { installTestHooks } from './testHooks';

const params = parseWebParams(window.location.search);

if (params.backend === 'live') {
  // Lands with the live bridge milestone; fail loudly rather than confusingly.
  throw new Error('web mode: ?backend=live is not implemented yet — use the fixture backend');
}

const fixture = getFixture(params.fixture);
const handle = createFixtureBackend(fixture, {
  style: params.style,
  ignoreWhitespace: params.ignoreWhitespace,
  delay: params.delay,
});
setPlatform(handle.backend);
installTestHooks({
  store: useReviewStore,
  backend: handle,
  fixtureId: fixture.id,
});

// ?file=<path>: select once the first refresh lands the model.
if (params.file) {
  const target = params.file;
  const unsubscribe = useReviewStore.subscribe((state) => {
    if (state.model) {
      const exists = [
        ...state.model.unreviewed,
        ...state.model.reviewed,
      ].some((file) => file.path === target);
      if (exists && state.selectedPath !== target) {
        useReviewStore.getState().select(target);
      }
      unsubscribe();
    }
  });
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
