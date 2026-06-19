# Supervision

A native macOS code-review companion for LLM-driven development.

You review the diff the way you'd review a teammate's PR — read the changes,
leave comments anchored to specific lines — and your coding agent picks the
comments up and applies them. Supervision stores review comments in
`.supervision/comments.json` at the repo root; the bundled `/supervision`
skill teaches an agent (Claude Code and friends) to read each open comment,
make the change, and reply inline in the same file. The working tree is
watched, so the review refreshes automatically as the agent edits.

Built on [Electrobun](https://electrobun.dev) — a single small native app
(~19 MB, uses the system WebView, no bundled Chromium).

## Install

> Supervision is unsigned (no paid Apple Developer certificate). The app is
> ad-hoc signed so it runs on Apple Silicon, but macOS Gatekeeper still
> quarantines anything downloaded from the internet. Homebrew is the smoothest
> path because it can strip the quarantine flag for you.

### Homebrew (recommended)

```bash
brew install --cask --no-quarantine johnliu/supervision/supervision
```

`--no-quarantine` lets the unsigned app launch without the Gatekeeper prompt.

### Direct download

Grab the `.dmg` from the [latest release](https://github.com/johnliu/supervision/releases/latest),
drag Supervision to Applications, then clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /Applications/Supervision.app
```

(Or launch it once, then approve it under System Settings → Privacy &
Security → "Open Anyway".)

> Releases are macOS Apple Silicon (`arm64`) only for now.

## Usage

Open a repo from the app, or launch it pointed at a directory from the
terminal:

```bash
supervision [dir]    # default: current directory
```

To get the `supervision` CLI on your PATH, symlink [`bin/supervision`](bin/supervision):

```bash
ln -s "$PWD/bin/supervision" /usr/local/bin/supervision
supervision ~/some/repo
```

It finds an installed `Supervision.app` (or this repo's dev build;
`SUPERVISION_APP` overrides) and passes the directory through both argv and
`SUPERVISION_REPO`.

### The review loop

1. Supervision shows the working-tree diff (unstaged/staged), commits, and
   range comparisons, plus markdown/image preview.
2. Select lines and leave a comment. Comments are saved to
   `.supervision/comments.json` and anchored to the file's content — they show
   as *stale* if the code drifts underneath them.
3. Ask your agent to address the review. With Claude Code, the bundled
   [`/supervision` skill](skills/supervision/SKILL.md) reads the open comments,
   applies each change, and replies in the JSON; the reply thread renders
   inline under the comment.

Install the skill into a repo from Supervision's settings, or copy
`skills/supervision/` into the project's skills directory.

## Development

Toolchain is pinned with [devbox](https://www.jetify.com/devbox) (Bun +
Node 22). Prefix commands with `devbox run --`, or run them inside `devbox
shell`.

```bash
devbox run -- bun install

devbox run -- bun run dev        # bundled assets, no HMR
devbox run -- bun run dev:hmr    # Vite dev server + Electrobun, HMR (recommended)
devbox run -- bun run build:canary   # local packaged build
```

> Note: edits to `src/bun/*` (the main Bun process) are **not** hot-reloaded —
> restart the dev command after changing them.

### Testing & web mode

The diff pane's behavior is specified in [docs/specs/](docs/specs/) — every
spec item maps to a test, and every bug fix starts with a failing spec-tagged
test (see [docs/specs/README.md](docs/specs/README.md) for the workflow).

```bash
# One-time: Playwright browsers
devbox run -- bun run playwright:install

devbox run -- bun run test:unit         # pure nav-model tests (bun test, ~100ms)
devbox run -- bun run test:e2e          # Playwright vs the real app in web mode (webkit + chromium)
devbox run -- bun run test:e2e:webkit   # webkit only — the engine family WKWebView ships
devbox run -- bun run test              # full gate: typecheck + unit + spec coverage + e2e

# Manual web mode: the real app in a browser on deterministic fixtures
devbox run -- bun run dev:web           # opens /web.html; ?fixture=gaps-large&style=unified etc.
```

Web mode (`src/mainview/web/`) renders the full app through the platform seam
(`src/mainview/platform.ts`) against an in-memory backend — no Electrobun.
Nothing web-mode ships in the packaged app.

### Project structure

```
├── src/
│   ├── bun/          # main process: git, watcher, RPC, comments, menu
│   ├── mainview/     # React UI (diff pane, comments, toolbar, settings)
│   │   └── web/      # web-mode backend + fixtures (tests only)
│   └── shared/       # types shared across the process boundary
├── skills/supervision/   # the /supervision agent skill
├── docs/specs/           # behavior specs (source of truth for the UI)
├── electrobun.config.ts  # app metadata, build & release config
└── vite.config.ts
```

## Releasing

See [RELEASE.md](RELEASE.md) for cutting a versioned release, publishing it to
GitHub Releases, and updating the Homebrew cask.

## License

All rights reserved. No license is granted at this time.
