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
  version "0.1.0"
  sha256 "68a87b2492a26bcfdbea9ff99ec9e7673f70c014b2e0436c0d78aa1b39260163" # shasum -a 256 stable-macos-arm64-Supervision.dmg

  url "https://github.com/johnliu/supervision/releases/download/v#{version}/stable-macos-arm64-Supervision.dmg"
  name "Supervision"
  desc "Native code-review companion for LLM-driven development"
  homepage "https://github.com/johnliu/supervision"

  # Apple Silicon only, and unsigned — clear quarantine after install (README).
  depends_on arch: :arm64

  app "Supervision.app"

  # Put the `supervision` CLI on PATH. It ships inside the bundle (see
  # electrobun.config.ts `copy`); Homebrew symlinks it into its bin directory.
  binary "#{appdir}/Supervision.app/Contents/Resources/app/supervision"

  zap trash: [
    "~/.supervision",
  ]
end
