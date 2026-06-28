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
  version "0.3.2"
  sha256 "60ad441ea2552ff87c05d99965ee893a947972c7b9b7fe13ac31dea23f017349" # shasum -a 256 stable-macos-arm64-Supervision.dmg

  url "https://github.com/johnliu/supervision/releases/download/v#{version}/stable-macos-arm64-Supervision.dmg"
  name "Supervision"
  desc "Native code-review companion for LLM-driven development"
  homepage "https://github.com/johnliu/supervision"

  # Apple Silicon only, and unsigned — clear quarantine after install (README).
  depends_on arch: :arm64

  app "Supervision.app"

  # The `supervision` CLI ships loose at the dmg root (next to the app), injected
  # by scripts/bundle-cli-into-dmg.sh. The in-bundle copy can't be used:
  # electrobun's stable build packs it into a .tar.zst unpacked only at first
  # launch, so it isn't on disk at install time. The CLI self-discovers
  # /Applications/Supervision.app, so the loose copy works wherever brew keeps it.
  binary "supervision"

  zap trash: [
    "~/.supervision",
  ]
end
