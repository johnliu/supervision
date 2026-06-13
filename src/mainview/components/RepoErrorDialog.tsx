// Modal shown when opening a project fails — the chosen folder isn't inside a
// git repository. Offers a one-click retry with the native folder picker.

import { TriangleAlert } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useReviewStore } from '../store';
import { Button } from './ui/button';

export function RepoErrorDialog() {
  const repoError = useReviewStore((state) => state.repoError);
  const clearRepoError = useReviewStore((state) => state.clearRepoError);
  const openProject = useReviewStore((state) => state.openProject);

  return (
    <Dialog.Root
      open={repoError !== null}
      onOpenChange={(open) => {
        if (!open) {
          clearRepoError();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[24rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover/95 p-5 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <TriangleAlert className="size-4.5 text-destructive" />
            </div>
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold">Couldn’t open project</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs break-words text-muted-foreground">
                {repoError}
              </Dialog.Description>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Supervision reviews git working trees — choose a folder inside a git repository.
              </p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearRepoError}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearRepoError();
                void openProject();
              }}
            >
              Choose Another Folder…
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
