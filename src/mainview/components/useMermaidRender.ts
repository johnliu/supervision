import { type RefObject, useEffect } from 'react';
import { resolveThemeType, useReviewStore } from '../store';

// Lazily imports mermaid the first time a diagram appears, then renders every
// `.obs-mermaid[data-diagram]` in the container. Re-renders when the resolved
// theme changes. SVG output is cached per (theme, source) so scrolling /
// re-mounts don't re-render.

type MermaidApi = {
  initialize(config: { startOnLoad: boolean; theme: 'dark' | 'default'; securityLevel: 'strict' }): void;
  render(
    id: string,
    source: string,
  ): Promise<{
    svg: string;
  }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let currentTheme: 'dark' | 'default' | null = null;
const cache = new Map<string, string>();
let nextId = 0;

async function loadMermaid(theme: 'dark' | 'default'): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default as unknown as MermaidApi);
  }
  const mermaid = await mermaidPromise;
  if (currentTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict',
    });
    currentTheme = theme;
    cache.clear();
  }
  return mermaid;
}

function cacheKey(theme: 'dark' | 'default', source: string): string {
  return `${theme}\x1f${source}`;
}

function decode(b64: string): string {
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return atob(b64);
  }
}

export function useMermaidRender(containerRef: RefObject<HTMLElement | null>, htmlSignal: string): void {
  const themeType = useReviewStore((state) => resolveThemeType(state.theme, state.systemDark));
  const mermaidTheme: 'dark' | 'default' = themeType === 'dark' ? 'dark' : 'default';

  // biome-ignore lint/correctness/useExhaustiveDependencies: htmlSignal is a re-render trigger only — the effect intentionally walks the freshly-rendered DOM.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const nodes = Array.from(container.querySelectorAll<HTMLDivElement>('.obs-mermaid[data-diagram]'));
    if (nodes.length === 0) {
      return;
    }
    let cancelled = false;

    void (async () => {
      const mermaid = await loadMermaid(mermaidTheme);
      if (cancelled) {
        return;
      }
      for (const node of nodes) {
        const encoded = node.getAttribute('data-diagram') ?? '';
        const source = decode(encoded);
        const key = cacheKey(mermaidTheme, source);
        const hit = cache.get(key);
        if (hit !== undefined) {
          node.innerHTML = hit;
          continue;
        }
        try {
          const id = `obs-mermaid-${nextId++}`;
          const { svg } = await mermaid.render(id, source);
          if (cancelled) {
            return;
          }
          cache.set(key, svg);
          node.innerHTML = svg;
        } catch (err) {
          if (cancelled) {
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          node.innerHTML = `<div class="obs-mermaid-error"><p>${msg.replace(/</g, '&lt;')}</p><pre>${source.replace(/</g, '&lt;')}</pre></div>`;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    containerRef,
    htmlSignal,
    mermaidTheme,
  ]);
}
