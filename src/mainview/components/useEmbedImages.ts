import { type RefObject, useEffect } from 'react';
import { api } from '../platform';

// Walks the rendered tree for img[data-embed="<path>"] and swaps in a data:
// URL fetched via readFile. v1 always uses the working-tree ref (undefined);
// per-side ref threading is a future enhancement (see design spec).
export function useEmbedImages(containerRef: RefObject<HTMLElement | null>, htmlSignal: string): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const nodes = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-embed]'));
    if (nodes.length === 0) {
      return;
    }
    let cancelled = false;
    for (const img of nodes) {
      const path = img.getAttribute('data-embed');
      if (!path) {
        continue;
      }
      api
        .readFile({ path })
        .then((payload) => {
          if (cancelled || !payload.ok) {
            return;
          }
          img.src = `data:${payload.mime};base64,${payload.base64}`;
        })
        .catch(() => {
          // Broken image state is fine; no special UI for v1.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [containerRef, htmlSignal]);
}
