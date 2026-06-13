// First-launch onboarding (radix Dialog, opened by the store when the
// persisted `onboarded` flag is false). Three steps: appearance preferences,
// the Claude Code feedback skill, and opening a repo to review. Every control
// writes through the same store setters as the settings dialog, so choices
// apply (and persist) immediately; finishing or skipping just records the
// flag so the flow never shows again.

import { Check, FolderGit2, FolderOpen, Moon, Sparkles, Sun, SunMoon } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { PALETTES, THEMES } from '../../shared/config';
import type { SkillStatus, ThemePreference } from '../../shared/types';
import { api } from '../platform';
import { useReviewStore } from '../store';
import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

const STEPS = [
  'Appearance',
  'Claude Code',
  'Open a project',
] as const;

function StepAppearance() {
  const theme = useReviewStore((state) => state.theme);
  const setTheme = useReviewStore((state) => state.setTheme);
  const palette = useReviewStore((state) => state.palette);
  const setPalette = useReviewStore((state) => state.setPalette);

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Pick a look to start with — everything here (and more) can be changed later in Settings (⌘,).
      </p>
      <div className="space-y-2">
        <div className="text-xs font-medium">Theme</div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={theme}
          onValueChange={(value) => {
            if (THEMES.some((entry) => entry.id === value)) {
              setTheme(value as ThemePreference);
            }
          }}
        >
          {THEMES.map((entry) => (
            <ToggleGroupItem
              key={entry.id}
              value={entry.id}
              aria-label={entry.label}
            >
              {entry.id === 'system' ? <SunMoon /> : entry.id === 'light' ? <Sun /> : <Moon />}
              {entry.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium">Base color</div>
        <div className="flex items-center gap-2">
          {PALETTES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-label={entry.label}
              title={entry.label}
              onClick={() => setPalette(entry.id)}
              className={cn(
                'size-6 rounded-full transition-shadow',
                palette === entry.id
                  ? 'ring-2 ring-ring ring-offset-2 ring-offset-popover'
                  : 'hover:ring-2 hover:ring-ring/40 hover:ring-offset-1 hover:ring-offset-popover',
              )}
              style={{
                backgroundColor: entry.swatch,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Same install plumbing as the settings dialog's SkillRow, presented as a
// step. Status is fetched on mount; installing flips the button to Installed.
function StepSkill() {
  const [status, setStatus] = useState<SkillStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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
  }, []);

  const install = async () => {
    setFailed(false);
    try {
      setStatus(await api.installSkill());
    } catch (error) {
      console.error('Skill install failed', error);
      setFailed(true);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Supervision saves your review comments to <code className="font-mono">.supervision/comments.json</code>. The{' '}
        <code className="font-mono">/supervision</code> skill teaches Claude Code to pick them up, apply the feedback,
        and reply in the thread.
      </p>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-xs font-medium">Claude Code skill</div>
            <div
              className="truncate font-mono text-[0.65rem] text-muted-foreground/70"
              title={status?.path}
            >
              {status?.path ?? '~/.claude/skills/supervision/SKILL.md'}
            </div>
          </div>
        </div>
        <Button
          variant={status?.upToDate ? 'ghost' : 'default'}
          size="sm"
          disabled={!status || status.upToDate}
          onClick={() => void install()}
        >
          {status?.upToDate ? (
            <>
              <Check />
              Installed
            </>
          ) : status?.installed ? (
            'Update'
          ) : (
            'Install'
          )}
        </Button>
      </div>
      {failed ? <p className="text-xs text-destructive">Install failed — check the app logs.</p> : null}
      <p className="text-xs text-muted-foreground">
        Optional — you can install it later from Settings, or skip it if you only want to read diffs.
      </p>
    </div>
  );
}

// The repo step rides on the store's repoInfo: it is non-null exactly when the
// app is pointed at a real git repo (refresh() clears it otherwise), and a
// successful open updates it via the repoChanged push → refresh.
function StepProject() {
  const repoInfo = useReviewStore((state) => state.repoInfo);
  const recentProjects = useReviewStore((state) => state.recentProjects);
  const openProject = useReviewStore((state) => state.openProject);
  const switchRepo = useReviewStore((state) => state.switchRepo);

  const recents = recentProjects.filter((path) => path !== repoInfo?.projectRoot).slice(0, 3);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Point Supervision at a git repository to review its changes. It watches the working tree, so edits made by an
        agent show up live.
      </p>
      {repoInfo ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
          <Check className="size-4 shrink-0 text-emerald-500" />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{repoInfo.root.split('/').pop()}</div>
            <div
              className="truncate font-mono text-[0.65rem] text-muted-foreground/70"
              title={repoInfo.root}
            >
              {repoInfo.root}
            </div>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          className="w-full justify-center"
          onClick={() => void openProject()}
        >
          <FolderOpen />
          Open Project…
        </Button>
      )}
      {recents.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">Recent</div>
          {recents.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => void switchRepo(path)}
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs">{path.split('/').pop()}</span>
              <span className="min-w-0 flex-1 truncate text-right font-mono text-[0.65rem] text-muted-foreground/70">
                {path}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {repoInfo ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void openProject()}
        >
          <FolderOpen />
          Choose a different project…
        </Button>
      ) : null}
    </div>
  );
}

export function OnboardingDialog() {
  const onboarding = useReviewStore((state) => state.onboarding);
  const completeOnboarding = useReviewStore((state) => state.completeOnboarding);
  const repoInfo = useReviewStore((state) => state.repoInfo);
  const [step, setStep] = useState(0);

  const last = step === STEPS.length - 1;

  return (
    <Dialog.Root open={onboarding}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        {/* No Dialog.Close and no onOpenChange: the flow only ends through
            Finish or "Skip setup", both of which persist the flag. */}
        <Dialog.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed top-1/2 left-1/2 z-50 w-[26rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover/95 p-5 text-popover-foreground shadow-2xl ring-1 ring-foreground/10 backdrop-blur-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="text-sm font-semibold">
            {step === 0 ? 'Welcome to Supervision' : STEPS[step]}
          </Dialog.Title>
          <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
            {step === 0
              ? 'Code review for human–agent collaboration. A minute of setup.'
              : step === 1
                ? 'Close the loop with your coding agent.'
                : 'Choose what to review.'}
          </Dialog.Description>

          <div className="mt-4 min-h-44">
            {step === 0 ? <StepAppearance /> : null}
            {step === 1 ? <StepSkill /> : null}
            {step === 2 ? <StepProject /> : null}
          </div>

          <div className="mt-5 flex items-center justify-between">
            {/* Step dots double as direct navigation. */}
            <div className="flex items-center gap-1.5">
              {STEPS.map((title, index) => (
                <button
                  key={title}
                  type="button"
                  aria-label={title}
                  onClick={() => setStep(index)}
                  className={cn(
                    'size-1.5 rounded-full transition-colors',
                    index === step ? 'bg-foreground' : 'bg-muted-foreground/30 hover:bg-muted-foreground/60',
                  )}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={completeOnboarding}
              >
                Skip setup
              </Button>
              {step > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </Button>
              ) : null}
              {last ? (
                <Button
                  size="sm"
                  disabled={!repoInfo}
                  onClick={completeOnboarding}
                >
                  Start reviewing
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setStep(step + 1)}
                >
                  Continue
                </Button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
