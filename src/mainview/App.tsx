import { useEffect } from 'react';
import { DiffPane } from './components/DiffPane';
import { QuickOpen } from './components/QuickOpen';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { TooltipProvider } from './components/ui/tooltip';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useReviewStore } from './store';

export default function App() {
  const refresh = useReviewStore((state) => state.refresh);
  const hydrateConfig = useReviewStore((state) => state.hydrateConfig);
  const loadRecentProjects = useReviewStore((state) => state.loadRecentProjects);
  const error = useReviewStore((state) => state.error);

  useKeyboardShortcuts();

  useEffect(() => {
    void hydrateConfig();
    void loadRecentProjects();
    void refresh();
  }, [
    hydrateConfig,
    loadRecentProjects,
    refresh,
  ]);

  // Suppress the webview's default context menu (Reload / Inspect Element…).
  // preventDefault doesn't stop propagation, so radix ContextMenu triggers
  // (toolbar) still open theirs; editable fields keep the native menu for
  // cut/copy/paste.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // Modern macOS shell: the window background is the sidebar surface (the
  // titlebar/traffic lights float over it), and the working area is an inset
  // rounded card — the Messages/Claude layout.
  return (
    <TooltipProvider>
      <div className="relative flex h-screen w-screen overflow-hidden bg-sidebar text-foreground">
        <Sidebar />
        <div className="min-w-0 flex-1 p-2 pl-0">
          {/* Concentric with the window: innerRadius = outerRadius − gap.
              This window class measures 16pt on Tahoe (NSThemeFrame probe)
              and the gutter is 8px, so the card gets 8px. Revisit if the
              gutter changes or electrobun ships an SDK-26 build (26pt). */}
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-border bg-background shadow-sm">
            {error ? (
              <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                {error}
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              <DiffPane />
            </div>
          </div>
        </div>
        <Toolbar />
      </div>
      <QuickOpen />
      <SettingsDialog />
      <ShortcutsDialog />
    </TooltipProvider>
  );
}
