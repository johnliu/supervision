// Settings panel (radix Dialog). Hosts the view preferences that are persisted
// to .supervision/config.json; opened from Supervision ▸ Settings… (Cmd+,).
// The controls share store state with the toolbar, so the two stay in sync.

import { AlignJustify, Columns2, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useReviewStore } from '../store';
import { FontSizeStepper } from './FontSizeStepper';
import { Switch } from './ui/switch';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

function Row({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog() {
  const settings = useReviewStore((state) => state.settings);
  const setSettings = useReviewStore((state) => state.setSettings);
  const diffStyle = useReviewStore((state) => state.diffStyle);
  const setDiffStyle = useReviewStore((state) => state.setDiffStyle);
  const ignoreWhitespace = useReviewStore((state) => state.ignoreWhitespace);
  const setIgnoreWhitespace = useReviewStore((state) => state.setIgnoreWhitespace);
  const lineWrap = useReviewStore((state) => state.lineWrap);
  const setLineWrap = useReviewStore((state) => state.setLineWrap);

  return (
    <Dialog.Root
      open={settings}
      onOpenChange={setSettings}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dark fixed inset-0 z-50 bg-black/40 backdrop-blur-xs data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="dark fixed top-1/2 left-1/2 z-50 w-[28rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover/95 p-5 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between">
            <div>
              <Dialog.Title className="text-sm font-semibold">Settings</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                Saved to .supervision/config.json
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="mt-4 space-y-4">
            <Row
              title="Diff view"
              description="Side-by-side or inline."
            >
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={diffStyle}
                onValueChange={(value) => {
                  if (value === 'split' || value === 'unified') {
                    setDiffStyle(value);
                  }
                }}
              >
                <ToggleGroupItem
                  value="split"
                  aria-label="Split view"
                >
                  <Columns2 />
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="unified"
                  aria-label="Unified view"
                >
                  <AlignJustify />
                </ToggleGroupItem>
              </ToggleGroup>
            </Row>

            {/* Same polarity as the toolbar toggle: on = whitespace visible. */}
            <Row
              title="Show whitespace"
              description="Include whitespace-only changes in diffs."
            >
              <Switch
                aria-label="Show whitespace"
                checked={!ignoreWhitespace}
                onCheckedChange={(on) => setIgnoreWhitespace(!on)}
              />
            </Row>

            <Row
              title="Wrap long lines"
              description="Wrap instead of scrolling horizontally."
            >
              <Switch
                aria-label="Wrap long lines"
                checked={lineWrap}
                onCheckedChange={setLineWrap}
              />
            </Row>

            <Row
              title="Font size"
              description="Diff text size in pixels."
            >
              <FontSizeStepper />
            </Row>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
