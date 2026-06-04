# Homebrew formula for Bakin

`bakin.rb` is the canonical formula. It lives here in the main repo so
any change to the install surface (new platform, test command update,
license change) lands in one place and gets reviewed with the rest of
the code.

This file is maintainer-facing. User install instructions live in the
[public install docs](https://makinbakin.com/docs/start/install/).

## User install

The preferred macOS install path is:

```sh
brew install markhayden/tap/bakin
```

Equivalent two-step form:

```sh
brew tap markhayden/tap
brew install bakin
```

The tap repository is `markhayden/homebrew-tap`, which Homebrew exposes
as `markhayden/tap`.

## Publishing a release to Homebrew

Homebrew itself doesn't read this file. The file belongs in a tap
repository — specifically `markhayden/homebrew-tap`, at
`Formula/bakin.rb`.

Stable releases publish the tap automatically from `.github/workflows/release.yml`:

1. The workflow builds binaries, signs/notarizes the macOS binary, packages
   release archives, then computes `dist/checksums.txt` for those archives.
2. `scripts/update-homebrew-formula.ts` renders this template with the
   release version and final checksums.
3. Stable releases clone `markhayden/homebrew-tap`, write
   `Formula/bakin.rb`, commit `bakin <version>`, and push.
4. RC releases render the formula as a dry-run validation but never push
   to the tap.

Local render check:

```sh
bun run scripts/update-homebrew-formula.ts --version 0.1.0 --checksums dist/checksums.txt --out /tmp/bakin.rb
```

## Why a single file per release, not `brew install --build-from-source`

Bakin is distributed as a Bun-compiled single-file binary. Building
from source would require Bun plus every dependency of every plugin on
the end user's machine. The binary already embeds everything the server
needs.
