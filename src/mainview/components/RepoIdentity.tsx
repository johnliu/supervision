// The footer's repo identity, two rows pairing segments by scope:
//   project ▾ / worktree ▾   — where you are
//   branch ▾ / compare       — what you're reviewing
// The menus switch (project = recents via ProjectSwitcher, worktree = setRepo
// to that checkout, branch = `git switch` in place); the compare label jumps
// to the History tab, which owns compare selection. Worktree/branch lists are
// fetched fresh each time a menu opens; both are cheap git calls.

import { Check, FolderTree, GitBranch, GitCompareArrows } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import type { BranchInfo, CommitInfo, CompareSpec, RepoInfo, WorktreeInfo } from '../../shared/types';
import { api } from '../platform';
import { useReviewStore } from '../store';
import { ProjectSwitcher } from './ProjectSwitcher';

function basename(somePath: string): string {
  const parts = somePath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? somePath;
}

/** Short label for the compare target ("working tree", "abc1234 → …"). */
export function compareLabel(compare: CompareSpec, log: CommitInfo[]): string {
  const short = (ref: string) => log.find((c) => c.hash === ref || c.shortHash === ref)?.shortHash ?? ref.slice(0, 7);
  switch (compare.kind) {
    case 'working':
      return 'working tree';
    case 'commit':
      return `${short(compare.ref)}`;
    case 'range':
      return `${short(compare.base)} → ${compare.head === null ? 'working tree' : short(compare.head)}`;
  }
}

const SEGMENT =
  'flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground focus:outline-none';

const MENU =
  'z-50 max-h-[60vh] max-w-[24rem] min-w-[14rem] overflow-y-auto rounded-lg bg-popover/95 p-1 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0';

const ITEM = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-muted';

function WorktreeMenu({ repoInfo }: { repoInfo: RepoInfo }) {
  const switchRepo = useReviewStore((state) => state.switchRepo);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) {
          api
            .getWorktrees()
            .then(setWorktrees)
            .catch(() => setWorktrees([]));
        }
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title={`Worktree: ${repoInfo.root}`}
          className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
        >
          <FolderTree className="size-3 shrink-0" />
          <span className="truncate">{repoInfo.worktree ?? 'main'}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className={MENU}
        >
          <DropdownMenu.Label className="px-2 py-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
            Worktrees
          </DropdownMenu.Label>
          {worktrees.map((worktree) => (
            <DropdownMenu.Item
              key={worktree.path}
              disabled={worktree.current}
              onSelect={() => void switchRepo(worktree.path)}
              className={`${ITEM} ${worktree.current ? 'data-[disabled]:opacity-100' : 'cursor-pointer'}`}
              title={worktree.path}
            >
              {worktree.current ? (
                <Check className="size-3.5 shrink-0 text-primary" />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{worktree.main ? 'main' : basename(worktree.path)}</span>
                <span className="truncate text-[0.65rem] text-muted-foreground">{worktree.branch ?? 'detached'}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function BranchMenu({ repoInfo }: { repoInfo: RepoInfo }) {
  const switchBranch = useReviewStore((state) => state.switchBranch);
  const [branches, setBranches] = useState<BranchInfo[]>([]);

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) {
          api
            .getBranches()
            .then(setBranches)
            .catch(() => setBranches([]));
        }
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title={`Branch: ${repoInfo.branch ?? 'detached'}`}
          className={SEGMENT}
        >
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{repoInfo.branch ?? 'detached'}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className={MENU}
        >
          <DropdownMenu.Label className="px-2 py-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
            Branches
          </DropdownMenu.Label>
          {branches.map((branch) => (
            <DropdownMenu.Item
              key={branch.name}
              disabled={branch.current || branch.worktree !== null}
              onSelect={() => void switchBranch(branch.name)}
              className={`${ITEM} ${branch.current ? 'data-[disabled]:opacity-100' : branch.worktree ? 'data-[disabled]:opacity-50' : 'cursor-pointer'}`}
              title={branch.worktree ? `Checked out in ${branch.worktree}` : branch.name}
            >
              {branch.current ? (
                <Check className="size-3.5 shrink-0 text-primary" />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 truncate">{branch.name}</span>
              {branch.worktree ? (
                <span className="ml-auto shrink-0 text-[0.65rem] text-muted-foreground">
                  in {basename(branch.worktree)}
                </span>
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The two identity rows; `onShowHistory` jumps to the History tab. */
export function RepoIdentity({ onShowHistory }: { onShowHistory: () => void }) {
  const repoInfo = useReviewStore((state) => state.repoInfo);
  const compare = useReviewStore((state) => state.compare);
  const log = useReviewStore((state) => state.log);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-0.5">
        <ProjectSwitcher />
        {repoInfo ? <WorktreeMenu repoInfo={repoInfo} /> : null}
      </div>
      <div className="flex min-w-0 items-center gap-0.5 text-[0.65rem] text-muted-foreground">
        {repoInfo?.branch ? <BranchMenu repoInfo={repoInfo} /> : null}
        <button
          type="button"
          title="Open history"
          onClick={onShowHistory}
          className={SEGMENT}
        >
          <GitCompareArrows className="size-3 shrink-0" />
          <span className="truncate">{compareLabel(compare, log)}</span>
        </button>
      </div>
    </div>
  );
}
