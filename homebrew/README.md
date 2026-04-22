# Homebrew formula for Bakin

`bakin.rb` is the canonical formula. It lives here in the main repo so
any change to the install surface (new platform, test command update,
license change) lands in one place and gets reviewed with the rest of
the code.

## Publishing a release to Homebrew

Homebrew itself doesn't read this file. The file belongs in a tap
repository — specifically `madeinwyo/homebrew-tap`, at
`Formula/bakin.rb`. For each Bakin release:

1. Build binaries + compute sha256 sums (the release workflow does this
   automatically and attaches `checksums.txt` to the GitHub release).
2. Copy `homebrew/bakin.rb` to `madeinwyo/homebrew-tap/Formula/bakin.rb`.
3. Replace the placeholders:
   - `__VERSION__` → the release tag without the leading `v` (e.g. `1.2.0`)
   - `__SHA256_DARWIN_ARM64__` → the sha256 of `bakin-darwin-arm64`
   - `__SHA256_LINUX_X64__` → the sha256 of `bakin-linux-x64`
   - `__SHA256_LINUX_ARM64__` → the sha256 of `bakin-linux-arm64`
4. Commit + push the tap repo. Users install with:

   ```sh
   brew tap madeinwyo/bakin
   brew install bakin
   ```

## Why a single file per release, not `brew install --build-from-source`

Bakin is distributed as a Bun-compiled single-file binary. Building
from source would require Bun + Node + Python + every dependency of
every plugin on the end user's machine. The binary is ~70 MB on macOS
arm64 and already embeds everything the server needs.
