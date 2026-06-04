# Homebrew formula for Bakin.
#
# This file is the CANONICAL template. Publishing to Homebrew involves
# copying it to the tap repository (markhayden/homebrew-tap) at
# Formula/bakin.rb and updating `url` + `sha256` for each release. See
# homebrew/README.md for the publish flow.
#
# The formula ships the prebuilt binary archive from the GitHub release
# rather than building from source — Bakin is distributed as a Bun-compiled
# single-file executable, not as a Ruby gem or Go binary compiled at
# install time.
class Bakin < Formula
  desc "Self-hosted multi-agent orchestration platform"
  homepage "https://github.com/markhayden/bakin"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/markhayden/bakin/releases/download/v__VERSION__/bakin-darwin-arm64.tar.gz"
      sha256 "__SHA256_DARWIN_ARM64__"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/markhayden/bakin/releases/download/v__VERSION__/bakin-linux-x64.tar.gz"
      sha256 "__SHA256_LINUX_X64__"
    end
    on_arm do
      url "https://github.com/markhayden/bakin/releases/download/v__VERSION__/bakin-linux-arm64.tar.gz"
      sha256 "__SHA256_LINUX_ARM64__"
    end
  end

  def install
    bin.install "bakin"
  end

  test do
    # `bakin version` prints the version string and exits 0.
    assert_match(/^\d+\.\d+\.\d+/, shell_output("#{bin}/bakin version"))
  end
end
