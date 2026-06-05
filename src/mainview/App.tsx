import { useEffect } from 'react';
import { DiffPane } from './components/DiffPane';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { useReviewStore } from './store';

export default function App() {
  const refresh = useReviewStore((state) => state.refresh);
  const error = useReviewStore((state) => state.error);

  useEffect(() => {
    void refresh();
  }, [
    refresh,
  ]);

  return (
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
  );
}
