// Project switcher: the sidebar-footer repo label becomes a dropdown to jump
// between recently-opened repos or pick a new one via the native folder
// dialog. Switching repoints the Bun side and re-hydrates the whole review.

import { Check, ChevronsUpDown, FolderOpen } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useReviewStore } from '../store';

function basename(repoPath: string): string {
  const parts = repoPath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? repoPath;
}

export function ProjectSwitcher() {
  const model = useReviewStore((state) => state.model);
  const recentProjects = useReviewStore((state) => state.recentProjects);
  const switchRepo = useReviewStore((state) => state.switchRepo);
  const openProject = useReviewStore((state) => state.openProject);

  const current = model?.repoRoot ?? '';
  // Recents minus the current repo — it already shows in the trigger + header.
  const others = recentProjects.filter((repoPath) => repoPath !== current);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title={current}
          className="flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
        >
          <span className="truncate">{current ? basename(current) : 'No project'}</span>
          <ChevronsUpDown className="ml-auto size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="dark z-50 max-w-[24rem] min-w-[16rem] overflow-hidden rounded-lg bg-popover/95 p-1 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {current ? (
            <>
              <DropdownMenu.Label className="px-2 py-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                Current
              </DropdownMenu.Label>
              <DropdownMenu.Item
                disabled
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[disabled]:opacity-100"
              >
                <Check className="size-3.5 shrink-0 text-primary" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{basename(current)}</span>
                  <span className="truncate text-[0.65rem] text-muted-foreground">{current}</span>
                </span>
              </DropdownMenu.Item>
            </>
          ) : null}

          {others.length > 0 ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Label className="px-2 py-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                Recent
              </DropdownMenu.Label>
              {others.map((repoPath) => (
                <DropdownMenu.Item
                  key={repoPath}
                  onSelect={() => void switchRepo(repoPath)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-muted"
                >
                  <span className="size-3.5 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{basename(repoPath)}</span>
                    <span className="truncate text-[0.65rem] text-muted-foreground">{repoPath}</span>
                  </span>
                </DropdownMenu.Item>
              ))}
            </>
          ) : null}

          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => void openProject()}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-muted"
          >
            <FolderOpen className="size-3.5 shrink-0 opacity-70" />
            <span>Open Project…</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
