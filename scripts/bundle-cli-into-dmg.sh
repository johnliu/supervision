#!/usr/bin/env bash
# Inject the standalone `supervision` CLI into the stable release dmg, loose at
# the dmg root next to Supervision.app, so the Homebrew cask can install it on
# PATH as a tracked `binary`.
#
# Why not ship it inside the app bundle (electrobun.config.ts `copy`)? The
# stable build packs the bundle into a .tar.zst that's only unpacked at first
# launch, so an in-bundle copy isn't on disk when Homebrew creates the symlink
# at install time (it fails with "symlink source ... is not there"). A loose
# copy in the dmg sidesteps that; the CLI self-discovers
# /Applications/Supervision.app, so its location on disk doesn't matter.
#
# Run by `build:stable` after `electrobun build`.
set -euo pipefail

dmg="artifacts/stable-macos-arm64-Supervision.dmg"
cli="bin/supervision"
[[ -f "$dmg" ]] || {
  echo "bundle-cli-into-dmg: dmg not found: $dmg" >&2
  exit 1
}
[[ -f "$cli" ]] || {
  echo "bundle-cli-into-dmg: cli not found: $cli" >&2
  exit 1
}

rw="$(mktemp -u)-rw.dmg"
mnt="$(mktemp -d)"
cleanup() {
  hdiutil detach "$mnt" >/dev/null 2>&1 || true
  rm -rf "$mnt" "$rw"
}
trap cleanup EXIT

# Modify a read-write copy, then recompress to the read-only UDZO the original
# was — this preserves electrobun's dmg layout/styling and only adds a file.
hdiutil convert "$dmg" -format UDRW -o "$rw" >/dev/null
hdiutil attach "$rw" -nobrowse -noverify -noautoopen -mountpoint "$mnt" >/dev/null
cp "$cli" "$mnt/supervision"
chmod +x "$mnt/supervision"
hdiutil detach "$mnt" >/dev/null
rm -f "$dmg"
hdiutil convert "$rw" -format UDZO -o "$dmg" >/dev/null

echo "bundle-cli-into-dmg: added supervision CLI to $dmg"
