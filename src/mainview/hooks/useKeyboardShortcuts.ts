// App-wide keyboard shortcuts. Bare-key shortcuts live here; the only
// modified shortcuts are Cmd/Ctrl+Shift+] / [ (next/prev file), which the
// native menu (Phase 6) will also own so the OS dispatches them. Shortcuts are
// ignored while the user is typing in a field.
//
//   ] / [ (with Cmd/Ctrl+Shift)  next / previous file
//   j / k                         move the line cursor down / up
//   c                             comment on the current selection
//   a / u                         approve / unapprove the current file
//   r                             refresh
//   \                             toggle split / unified
//   w                             toggle ignore-whitespace
//   Esc                           clear selection / close composer

import { useEffect } from 'react';
import { useReviewStore } from '../store';

/** True when keyboard focus is in a text-editing field. */
function isEditing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  return element.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditing(event.target)) {
        return;
      }
      const state = useReviewStore.getState();

      // Cmd/Ctrl+Shift+] / [ (next/prev file) is owned by the native menu's
      // accelerators so it fires once; the webview must not also handle it.
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const working = state.compare.kind === 'working';
      switch (event.key) {
        // j / k (move the line cursor) are handled in DiffPane, which owns the
        // diff DOM needed to scroll the cursor into view.
        case 'c':
          if (state.selectedPath && state.selectedLines) {
            event.preventDefault();
            state.commentOnRange(state.selectedPath, state.selectedLines);
          }
          break;
        case 'a':
          if (working && state.selectedPath) {
            event.preventDefault();
            void state.approve([
              state.selectedPath,
            ]);
          }
          break;
        case 'u':
          if (working && state.selectedPath) {
            event.preventDefault();
            void state.unapprove([
              state.selectedPath,
            ]);
          }
          break;
        case 'r':
          event.preventDefault();
          void state.refresh();
          break;
        case 'w':
          event.preventDefault();
          state.setIgnoreWhitespace(!state.ignoreWhitespace);
          break;
        case '\\':
          event.preventDefault();
          state.setDiffStyle(state.diffStyle === 'split' ? 'unified' : 'split');
          break;
        case 'Escape':
          state.closeDraft();
          state.setSelectedLines(null);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
