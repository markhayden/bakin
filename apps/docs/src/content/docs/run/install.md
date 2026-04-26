---
title: Install Bakin
description: Install the released Bakin binary with the recommended one-line installer.
---

# Install Bakin

The recommended installation path is the one-line installer for the released `bakin` binary.

```sh
curl -fsSL https://raw.githubusercontent.com/madeinwyo/bakin/main/install.sh | bash
```

The installer detects the platform, verifies the release checksum, and installs the binary on your `PATH`.

## Verify

```sh
bakin version
```

## Alternatives

Manual release downloads, Homebrew, and source builds are secondary paths. Contributor source setup is documented separately under [Contribute](/contribute/overview/).

## Next Step

Run first-time setup:

```sh
bakin onboard
```
