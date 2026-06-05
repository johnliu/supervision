// Renders the selected file's diff using @pierre/diffs. `diffStyle` switches
// between unified and split. The `key` forces a clean remount when switching
// files or sides so the virtualized renderer resets cleanly.

import { PatchDiff, Virtualizer } from '@pierre/diffs/react';
import { useMemo } from 'react';
import { useReviewStore } from '../store';

export function DiffPane() {
  const model = useReviewStore((state) => state.model);
  const selectedPath = useReviewStore((state) => state.selectedPath);
  const diffStyle = useReviewStore((state) => state.diffStyle);

  const file = useMemo(() => {
    if (!model || !selectedPath) {
      return null;
    }
    // Prefer the unstaged ("new") side when a file appears in both buckets.
    const all = [
      ...model.unreviewed,
      ...model.reviewed,
    ];
    return all.find((entry) => entry.path === selectedPath) ?? null;
  }, [
    model,
    selectedPath,
  ]);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">Select a file to review</div>
    );
  }

  return (
    <Virtualizer className="h-full overflow-auto bg-neutral-950">
      <PatchDiff
        key={`${file.path}:${file.staged ? 'staged' : 'unstaged'}`}
        patch={file.patch}
        options={{
          diffStyle,
          theme: {
            dark: 'pierre-dark',
            light: 'pierre-light',
          },
          themeType: 'system',
        }}
        disableWorkerPool
      />
    </Virtualizer>
  );
}
