# Releasing Supervision

Supervision ships as an unsigned macOS Apple Silicon (`arm64`) app, distributed
through GitHub Releases and a Homebrew cask. This is the end-to-end checklist
for cutting a release.

## Prerequisites

- A clean `main` with everything you want to ship merged in.
- The [`gh`](https://cli.github.com) CLI authenticated (`gh auth login`), or do
  the upload step manually in the GitHub UI.
- The Homebrew tap repo `johnliu/homebrew-supervision` (see
  [Homebrew tap](#homebrew-tap) below) if you want `brew install` to work.

## 1. Bump the version

The version that actually ships is `app.version` in
[`electrobun.config.ts`](electrobun.config.ts). Keep `package.json`'s `version`
in sync so they don't drift.

```
electrobun.config.ts → app.version
package.json         → version
```

Use the same `X.Y.Z` in both. The git tag below is `v` + that version.

## 2. Build the stable artifacts

```bash
devbox run -- bun run build:stable
```

This runs `vite build` then `electrobun build --env=stable` and writes three
files to `artifacts/`:

| File | What it is |
| --- | --- |
| `stable-macos-arm64-Supervision.dmg` | the drag-to-Applications installer (what users download) |
| `stable-macos-arm64-Supervision.app.tar.zst` | compressed bundle used by the auto-updater |
| `stable-macos-arm64-update.json` | updater manifest (version + hash) |

> **Signing.** The build is unsigned — `codesign`/`notarize` are off in
> `electrobun.config.ts` because there's no paid Apple Developer certificate.
> Electrobun still ad-hoc signs the binary, which is enough to run on Apple
> Silicon but **not** enough to clear Gatekeeper on a downloaded app. That's
> why the install instructions have users clear the quarantine flag with
> `xattr` after installing (Homebrew dropped `--no-quarantine`, so it no longer
> does this for you). If you ever get a Developer ID cert, flip
> `mac: { codesign: true, notarize: true }` and add
> the credential env vars Electrobun expects — then the workarounds go away.

Smoke-test the build before publishing:

```bash
open artifacts/stable-macos-arm64-Supervision.dmg   # drag to /Applications, launch
```

## 3. Tag and publish to GitHub Releases

```bash
VERSION=0.1.0   # match electrobun.config.ts

command git tag "v$VERSION"
command git push origin "v$VERSION"

gh release create "v$VERSION" \
  artifacts/stable-macos-arm64-Supervision.dmg \
  artifacts/stable-macos-arm64-Supervision.app.tar.zst \
  artifacts/stable-macos-arm64-update.json \
  --title "v$VERSION" \
  --notes "…release notes…"
```

Upload **all three** artifacts. The app's auto-updater
(`release.baseUrl` → `releases/latest/download`) reads `update.json` and the
`.app.tar.zst` from the *latest* release, so every release must carry them or
updates break.

## 4. Update the Homebrew cask

After the release is live, get the dmg's checksum and bump the cask in the tap:

```bash
shasum -a 256 artifacts/stable-macos-arm64-Supervision.dmg
```

Edit `Casks/supervision.rb` in `johnliu/homebrew-supervision` — update
`version` and `sha256` — then commit and push. A copy of the cask lives at
[`packaging/homebrew/supervision.rb`](packaging/homebrew/supervision.rb) as the
source of truth; keep the two in sync.

Verify:

```bash
brew update
brew upgrade --cask johnliu/supervision/supervision   # or `install` if first time
xattr -dr com.apple.quarantine /Applications/Supervision.app
```

## Homebrew tap

A GUI `.app` is distributed as a Homebrew **cask**. The simplest route that
needs no review is a personal tap: a repo named `homebrew-supervision` under
your account, containing `Casks/supervision.rb`. Users then install with:

```bash
brew install --cask johnliu/supervision/supervision
xattr -dr com.apple.quarantine /Applications/Supervision.app
```

(Homebrew removed `--no-quarantine`, so the unsigned app needs its quarantine
flag cleared once after install — same step as the direct `.dmg` download.)

(`johnliu/supervision` resolves to the `johnliu/homebrew-supervision` repo;
the trailing `supervision` is the cask name.)

One-time setup:

```bash
# create an empty github repo named homebrew-supervision, then:
mkdir -p homebrew-supervision/Casks
cp packaging/homebrew/supervision.rb homebrew-supervision/Casks/
cd homebrew-supervision && command git init && command git add . \
  && command git commit -m "supervision cask" \
  && command git remote add origin https://github.com/johnliu/homebrew-supervision.git \
  && command git push -u origin main
```

The official `homebrew/cask` repo does **not** accept unsigned apps, so the
personal tap is the path until the app is signed + notarized.
