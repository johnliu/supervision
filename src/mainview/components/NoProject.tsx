// The main-pane empty state when no project is open: a bare launch (Finder /
// Dock) with no git repo at the cwd and no usable recent. The sidebar footer's
// ProjectSwitcher offers recents; this just gets the user to the folder picker.

import { FolderOpen } from 'lucide-react';
import { useReviewStore } from '../store';
import { Button } from './ui/button';

export function NoProject() {
  const openProject = useReviewStore((state) => state.openProject);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <FolderOpen className="size-9 text-muted-foreground/40" />
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">No project open</h2>
        <p className="max-w-xs text-xs text-muted-foreground">
          Open a Git repository to review its working tree, commits, and history.
        </p>
      </div>
      <Button
        type="button"
        size="lg"
        onClick={() => void openProject()}
      >
        <FolderOpen />
        Open Project…
      </Button>
    </div>
  );
}
