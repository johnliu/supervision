// Settings panel (radix Dialog). Hosts the view preferences that are persisted
// to .supervision/config.json; opened from Supervision ▸ Settings… (Cmd+,).
// The controls share store state with the toolbar, so the two stay in sync.

import { AlignJustify, Columns2, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { EDITORS } from '../../shared/config';
import type { EditorId, SkillStatus } from '../../shared/types';
import { api } from '../platform';
import { useReviewStore } from '../store';
import { FontSizeStepper } from './FontSizeStepper';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
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

// Install/update the Claude Code feedback skill so an agent can apply the
// review comments and respond in comments.json. Status is fetched each time
// the dialog opens — the user may (un)install outside the app.
function SkillRow({ open }: { open: boolean }) {
  const [status, setStatus] = useState<SkillStatus | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    api
      .getSkillStatus()
      .then((next) => {
        if (!cancelled) {
          setStatus(next);
        }
      })
      .catch(() => setStatus(null));
    return () => {
      cancelled = true;
    };
  }, [
    open,
  ]);

  const install = async () => {
    try {
      setStatus(await api.installSkill());
    } catch (error) {
      console.error('Skill install failed', error);
    }
  };

  return (
    <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">Claude Code skill</div>
        <div className="text-xs text-muted-foreground">
          <code className="font-mono">/supervision</code> — the agent applies comments and replies in comments.json.
        </div>
        {status ? (
          <div
            className="mt-0.5 truncate font-mono text-[0.65rem] text-muted-foreground/70"
            title={status.path}
          >
            {status.path}
          </div>
        ) : null}
      </div>
      <Button
        variant={status?.upToDate ? 'ghost' : 'outline'}
        size="sm"
        disabled={!status || status.upToDate}
        onClick={() => void install()}
      >
        {status?.upToDate ? 'Installed' : status?.installed ? 'Update' : 'Install'}
      </Button>
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
  const editor = useReviewStore((state) => state.editor);
  const setEditor = useReviewStore((state) => state.setEditor);

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
              {/* spacing=0 joins the buttons into one bordered group. */}
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={diffStyle}
                onValueChange={(value) => {
                  if (value === 'split' || value === 'unified') {
                    setDiffStyle(value);
                  }
                }}
              >
                <ToggleGroupItem
                  value="split"
                  aria-label="Split"
                >
                  <Columns2 />
                  Split
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="unified"
                  aria-label="Unified"
                >
                  <AlignJustify />
                  Unified
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

            <Row
              title="Editor"
              description="Where “Open in editor” sends files."
            >
              <Select
                value={editor}
                onValueChange={(value) => setEditor(value as EditorId)}
              >
                <SelectTrigger
                  size="sm"
                  className="w-40"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITORS.map((entry) => (
                    <SelectItem
                      key={entry.id}
                      value={entry.id}
                    >
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>

            <SkillRow open={settings} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
