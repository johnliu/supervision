# Homebrew cask for Supervision.
#
# Source of truth — copy this into the tap repo `johnliu/homebrew-supervision`
# at `Casks/supervision.rb`, and bump `version` + `sha256` on every release
# (see RELEASE.md). Install with:
#
#   brew install --cask johnliu/supervision/supervision
#   xattr -dr com.apple.quarantine /Applications/Supervision.app
#
# (Homebrew no longer supports --no-quarantine, so the unsigned app needs the
# quarantine flag cleared once after install.)
#
cask "supervision" do
  version "0.2.0"
  sha256 "bcf93928ba4160e0109ecf8b0cd2af7e21805968bafb453e097c05783ff4ab92" # shasum -a 256 stable-macos-arm64-Supervision.dmg

  url "https://github.com/johnliu/supervision/releases/download/v#{version}/stable-macos-arm64-Supervision.dmg"
  name "Supervision"
  desc "Native code-review companion for LLM-driven development"
  homepage "https://github.com/johnliu/supervision"

  # Apple Silicon only, and unsigned — clear quarantine after install (README).
  depends_on arch: :arm64

  app "Supervision.app"

  # No `binary` stanza: electrobun's stable build packs the bundle into a
  # .tar.zst that's only unpacked at first launch, so
  # Contents/Resources/app/supervision doesn't exist when Homebrew makes the
  # symlink at install time (it fails with "symlink source ... is not there").
  # Putting the CLI on PATH needs bin/supervision installed independently of the
  # bundle — it already self-discovers /Applications/Supervision.app.

  zap trash: [
    "~/.supervision",
  ]
end
