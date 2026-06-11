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

  return (
    <TooltipProvider>
      <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        {error ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive [.platform-desktop_&]:pt-9">
            {error}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <div className="min-w-0 flex-1">
            <DiffPane />
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
