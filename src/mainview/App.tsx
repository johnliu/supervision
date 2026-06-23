import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import { useEffect } from 'react';
import { diffThemePair } from '../shared/config';
import { CommitDetailsPane, RangeDetailsPane } from './components/CommitDetailsPane';
import { DiffPane } from './components/DiffPane';
import { NoProject } from './components/NoProject';
import { OnboardingDialog } from './components/OnboardingDialog';
import { QuickOpen } from './components/QuickOpen';
import { RepoErrorDialog } from './components/RepoErrorDialog';
import { SearchBar } from './components/SearchBar';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { TooltipProvider } from './components/ui/tooltip';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { diffWorkerFactory, DIFF_WORKER_POOL_SIZE } from './diffWorker';
import { DRAG_REGION, NO_DRAG_REGION } from './lib/dragRegion';
import { resolveThemeType, useReviewStore } from './store';

export default function App() {
  const refresh = useReviewStore((state) => state.refresh);
  const hydrateConfig = useReviewStore((state) => state.hydrateConfig);
  const loadRecentProjects = useReviewStore((state) => state.loadRecentProjects);
  const error = useReviewStore((state) => state.error);
  const repoOpen = useReviewStore((state) => state.repoOpen);
  const theme = useReviewStore((state) => state.theme);
  // Ref comparison with no file picked: show its details overview ('commit'
  // → the commit page, 'range' → the compare view); null means the diff.
  const overview = useReviewStore((state) =>
    state.selectedPath === null && state.compare.kind !== 'working' ? state.compare.kind : null,
  );
  const palette = useReviewStore((state) => state.palette);
  const systemDark = useReviewStore((state) => state.systemDark);
  const setSystemDark = useReviewStore((state) => state.setSystemDark);
  // Initial highlighter theme for the worker pool (created once). Live theme
  // switches are pushed to the pool from DiffPane; this just avoids a first-paint
  // mismatch before config hydrates.
  const initialDiffTheme = useReviewStore((state) => state.diffTheme);

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

  // Track the OS appearance so a 'system' preference follows it live.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(query.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [
    setSystemDark,
  ]);

  // The `dark` class on <html> drives the whole app palette (index.css).
  // index.html ships with it pre-set so the first dark paint doesn't flash.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolveThemeType(theme, systemDark) === 'dark');
  }, [
    theme,
    systemDark,
  ]);

  // data-palette swaps the gray family's hue/chroma knobs (index.css).
  // Olive is the stock palette — no attribute.
  useEffect(() => {
    if (palette === 'olive') {
      delete document.documentElement.dataset.palette;
    } else {
      document.documentElement.dataset.palette = palette;
    }
  }, [
    palette,
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
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: diffWorkerFactory,
        poolSize: DIFF_WORKER_POOL_SIZE,
      }}
      highlighterOptions={{
        theme: diffThemePair(initialDiffTheme),
      }}
    >
      <TooltipProvider>
        {/* The window shell is one big drag region; the sidebar controls, the
          content card, and the toolbar punch no-drag holes (see dragRegion.ts),
          leaving the inset frame and the sidebar's top band to move the window. */}
      <div className={`relative flex h-screen w-screen overflow-hidden bg-sidebar text-foreground ${DRAG_REGION}`}>
        <Sidebar />
        <div className="min-w-0 flex-1 p-2 pl-0">
          {/* Concentric with the window: innerRadius = outerRadius − gap.
              This window class measures 16pt on Tahoe (NSThemeFrame probe)
              and the gutter is 8px, so the card gets 8px. Revisit if the
              gutter changes or electrobun ships an SDK-26 build (26pt). */}
          <div
            className={`relative flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-border bg-background shadow-sm ${NO_DRAG_REGION}`}
          >
            <SearchBar />
            {error ? (
              <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                {error}
              </div>
            ) : null}
            <div
              id="search-scope"
              className="min-h-0 flex-1"
            >
              {!repoOpen ? (
                <NoProject />
              ) : overview === 'commit' ? (
                <CommitDetailsPane />
              ) : overview === 'range' ? (
                <RangeDetailsPane />
              ) : (
                <DiffPane />
              )}
            </div>
          </div>
        </div>
        <Toolbar />
      </div>
      <QuickOpen />
      <SettingsDialog />
      <ShortcutsDialog />
      <OnboardingDialog />
      <RepoErrorDialog />
      </TooltipProvider>
    </WorkerPoolContextProvider>
  );
}
