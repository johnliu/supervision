// Cmd+K quick-open: a command-palette modal to fuzzy-find and jump to a changed
// file. Opened via the native menu (Go ▸ Quick Open…) which flips the store's
// `quickOpen` flag. Arrow keys move the selection, Enter opens, Esc closes.

import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReviewStore } from '../store';

// Subsequence fuzzy match; lower score = better. null means no match.
function fuzzyScore(path: string, query: string): number | null {
  if (query === '') {
    return 0;
  }
  const haystack = path.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;
  let score = 0;
  let previous = -2;
  for (const char of needle) {
    const at = haystack.indexOf(char, from);
    if (at === -1) {
      return null;
    }
    // Reward consecutive matches; penalize gaps and later positions.
    score += at === previous + 1 ? 0 : at - from + 1;
    previous = at;
    from = at + 1;
  }
  // Strong bonus when the query is a substring of the file name.
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (name.includes(needle)) {
    score -= 1000;
  }
  return score;
}

export function QuickOpen() {
  const quickOpen = useReviewStore((state) => state.quickOpen);
  const setQuickOpen = useReviewStore((state) => state.setQuickOpen);
  const model = useReviewStore((state) => state.model);
  const select = useReviewStore((state) => state.select);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const paths = useMemo(
    () =>
      [
        ...(model?.unreviewed ?? []),
        ...(model?.reviewed ?? []),
      ].map((file) => file.path),
    [
      model,
    ],
  );

  const results = useMemo(() => {
    return paths
      .map((path) => ({
        path,
        score: fuzzyScore(path, query),
      }))
      .filter(
        (
          entry,
        ): entry is {
          path: string;
          score: number;
        } => entry.score !== null,
      )
      .sort((a, b) => a.score - b.score)
      .slice(0, 50)
      .map((entry) => entry.path);
  }, [
    paths,
    query,
  ]);

  // Reset query and selection each time the palette opens.
  useEffect(() => {
    if (quickOpen) {
      setQuery('');
      setActive(0);
    }
  }, [
    quickOpen,
  ]);

  // Clamp the active row as the result set changes, and keep it in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-clamp on results length too.
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, results.length - 1)));
    activeRef.current?.scrollIntoView({
      block: 'nearest',
    });
  }, [
    results,
    active,
  ]);

  const choose = (path: string | undefined) => {
    if (path) {
      select(path);
    }
    setQuickOpen(false);
  };

  return (
    <Dialog.Root
      open={quickOpen}
      onOpenChange={setQuickOpen}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dark fixed inset-0 z-50 bg-black/40 backdrop-blur-xs data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="dark fixed top-[18%] left-1/2 z-50 w-[34rem] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-xl bg-popover/95 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="sr-only">Quick open file</Dialog.Title>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((current) => Math.min(results.length - 1, current + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((current) => Math.max(0, current - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(results[active]);
              }
            }}
            placeholder="Jump to a changed file…"
            className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <ul className="max-h-80 overflow-y-auto p-1">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">No matching files</li>
            ) : (
              results.map((path, index) => {
                const slash = path.lastIndexOf('/');
                const dir = slash === -1 ? '' : path.slice(0, slash + 1);
                const name = slash === -1 ? path : path.slice(slash + 1);
                return (
                  <li key={path}>
                    <button
                      ref={index === active ? activeRef : undefined}
                      type="button"
                      data-active={index === active}
                      onClick={() => choose(path)}
                      onMouseMove={() => setActive(index)}
                      className="flex w-full items-baseline gap-1.5 rounded-md px-3 py-1.5 text-left data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
                    >
                      <span className="shrink-0 truncate text-sm font-medium">{name}</span>
                      <span className="truncate text-xs text-muted-foreground">{dir}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
