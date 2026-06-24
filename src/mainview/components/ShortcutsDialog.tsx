// Keyboard-shortcuts cheat sheet (radix Dialog). Opened with Cmd+/ (via the
// Help menu) or Help ▸ Keyboard Shortcuts. Static reference — the source of
// truth for the bindings is useKeyboardShortcuts.ts (bare keys), DiffPane.tsx
// (diff nav), and menu.ts (Cmd accelerators); keep this in sync when those
// change.

import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useReviewStore } from '../store';
import { Kbd } from './ui/kbd';

interface Shortcut {
  /** One or more key chords; multiple chords render separated by "/". */
  combos: string[][];
  label: string;
}

const GROUPS: {
  title: string;
  items: Shortcut[];
}[] = [
  {
    title: 'Files & navigation',
    items: [
      {
        combos: [
          [
            '⌘',
            '⇧',
            ']',
          ],
          [
            '⌘',
            '⇧',
            '[',
          ],
        ],
        label: 'Next / previous file',
      },
      {
        combos: [
          [
            '⌘',
            'K',
          ],
        ],
        label: 'Quick open file',
      },
      {
        combos: [
          [
            ']',
          ],
          [
            '[',
          ],
        ],
        label: 'Next / previous change',
      },
      {
        combos: [
          [
            'j',
          ],
          [
            'k',
          ],
        ],
        label: 'Move line cursor down / up',
      },
      {
        combos: [
          [
            '⏎',
          ],
          [
            'Space',
          ],
        ],
        label: 'Expand collapsed lines (on a bar)',
      },
    ],
  },
  {
    title: 'Selection & comments',
    items: [
      {
        combos: [
          [
            'Click',
          ],
          [
            'Drag',
          ],
        ],
        label: 'Select line(s)',
      },
      {
        combos: [
          [
            '⇧',
            'Click',
          ],
        ],
        label: 'Extend selection',
      },
      {
        combos: [
          [
            '⇧',
            'J',
          ],
          [
            '⇧',
            'K',
          ],
        ],
        label: 'Grow / shrink selection',
      },
      {
        combos: [
          [
            'c',
          ],
        ],
        label: 'Comment on selection',
      },
      {
        combos: [
          [
            '⌘',
            '⏎',
          ],
        ],
        label: 'Save comment',
      },
      {
        combos: [
          [
            'Esc',
          ],
        ],
        label: 'Clear selection / close',
      },
    ],
  },
  {
    title: 'Review',
    items: [
      {
        combos: [
          [
            'a',
          ],
          [
            'u',
          ],
        ],
        label: 'Approve / unapprove file',
      },
      {
        combos: [
          [
            'm',
          ],
        ],
        label: 'Mark file read / unread',
      },
      {
        combos: [
          [
            'r',
          ],
        ],
        label: 'Refresh',
      },
      {
        combos: [
          [
            '⌘',
            '⇧',
            'E',
          ],
        ],
        label: 'Copy comments for LLM',
      },
    ],
  },
  {
    title: 'View & app',
    items: [
      {
        combos: [
          [
            '\\',
          ],
        ],
        label: 'Toggle split / unified',
      },
      {
        combos: [
          [
            'p',
          ],
        ],
        label: 'Preview file (markdown)',
      },
      {
        combos: [
          [
            'w',
          ],
        ],
        label: 'Toggle ignore whitespace',
      },
      {
        combos: [
          [
            '⌘',
            ',',
          ],
        ],
        label: 'Settings',
      },
      {
        combos: [
          [
            '⌘',
            'O',
          ],
        ],
        label: 'Open project',
      },
      {
        combos: [
          [
            '⌘',
            '/',
          ],
        ],
        label: 'Keyboard shortcuts',
      },
    ],
  },
];

function Keys({ combos }: { combos: string[][] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {combos.map((chord, chordIndex) => (
        <span
          key={chord.join('-')}
          className="flex items-center gap-1"
        >
          {chordIndex > 0 ? <span className="text-muted-foreground">/</span> : null}
          {chord.map((token) => (
            <Kbd key={token}>{token}</Kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsDialog() {
  const shortcuts = useReviewStore((state) => state.shortcuts);
  const setShortcuts = useReviewStore((state) => state.setShortcuts);

  return (
    <Dialog.Root
      open={shortcuts}
      onOpenChange={setShortcuts}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[44rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-popover/95 p-5 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between">
            <div>
              <Dialog.Title className="text-sm font-semibold">Keyboard Shortcuts</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                Diff shortcuts apply while a file is open.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            {GROUPS.map((group) => (
              <div key={group.title}>
                <div className="mb-2 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                  {group.title}
                </div>
                <div className="space-y-1.5">
                  {group.items.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between gap-4"
                    >
                      <span className="min-w-0 truncate text-xs text-foreground">{item.label}</span>
                      <Keys combos={item.combos} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
