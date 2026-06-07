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

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <Toolbar />
        {error ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <div className="min-w-0 flex-1">
            <DiffPane />
          </div>
        </div>
      </div>
      <QuickOpen />
      <SettingsDialog />
      <ShortcutsDialog />
    </TooltipProvider>
  );
}
