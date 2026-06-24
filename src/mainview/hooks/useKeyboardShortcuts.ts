// App-wide keyboard shortcuts. Bare-key shortcuts live here; the only
// modified shortcuts are Cmd/Ctrl+Shift+] / [ (next/prev file), which the
// native menu (Phase 6) will also own so the OS dispatches them. Shortcuts are
// ignored while the user is typing in a field.
//
//   ] / [ (with Cmd/Ctrl+Shift)  next / previous file
//   j / k                         move the line cursor down / up (DiffPane)
//   ] / [                         jump to next / previous change (DiffPane)
//   c                             comment on the current selection
//   a / u                         approve / unapprove the current file
//   m                             mark the current file read / unread
//   r                             refresh
//   p                             toggle preview (markdown)
//   \                             toggle split / unified
//   w                             toggle ignore-whitespace
//   = / -                         increase / decrease text size
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
      // Cmd/Ctrl+F opens the find bar. Handled here (in addition to the native
      // menu accelerator) so it works while typing and in web/dev mode where
      // there's no native menu; setSearch(true) is idempotent, so the two paths
      // firing together on desktop is harmless.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        useReviewStore.getState().setSearch(true);
        return;
      }
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
        // Mark read works in every mode (no `working` gate). Prefer the
        // unstaged entry — the side setRead fingerprints — and skip files with
        // no readable content (binary, deleted).
        case 'm': {
          const target =
            state.model?.unreviewed.find((file) => file.path === state.selectedPath) ??
            state.model?.reviewed.find((file) => file.path === state.selectedPath);
          if (target && !target.binary && target.status !== 'deleted') {
            event.preventDefault();
            void state.setRead(
              [
                target.path,
              ],
              !target.read,
            );
          }
          break;
        }
        case 'r':
          event.preventDefault();
          void state.refresh();
          break;
        case 'p':
          event.preventDefault();
          state.togglePreview();
          break;
        case 'w':
          event.preventDefault();
          state.setIgnoreWhitespace(!state.ignoreWhitespace);
          break;
        // '=' and its shifted '+' both grow; '-'/'_' shrink. setFontSize
        // clamps to the configured min/max.
        case '=':
        case '+':
          event.preventDefault();
          state.setFontSize(state.fontSize + 1);
          break;
        case '-':
        case '_':
          event.preventDefault();
          state.setFontSize(state.fontSize - 1);
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
