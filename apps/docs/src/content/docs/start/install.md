---
title: Install Bakin
description: Install the released Bakin binary with the recommended one-line installer.
---

The recommended installation path is the one-line installer for the released `bakin` binary.

```sh
curl -fsSL https://raw.githubusercontent.com/madeinwyo/bakin/main/install.sh | bash
```

The installer detects the platform, downloads the matching release asset, verifies the SHA-256 checksum from `checksums.txt`, and installs the binary as `bakin`.

## Supported Platforms

The release installer currently supports:

| Platform | Asset |
| --- | --- |
| macOS Apple Silicon | `bakin-darwin-arm64` |
| Linux x64 | `bakin-linux-x64` |
| Linux arm64 | `bakin-linux-arm64` |

## Install Location

By default, the installer writes to `/usr/local/bin` when that directory is writable. Otherwise it falls back to `~/.local/bin`.

Set `BAKIN_INSTALL_DIR` to choose the destination:

```sh
curl -fsSL https://raw.githubusercontent.com/madeinwyo/bakin/main/install.sh | BAKIN_INSTALL_DIR="$HOME/bin" bash
```

Install a specific release tag with `BAKIN_VERSION`:

```sh
curl -fsSL https://raw.githubusercontent.com/madeinwyo/bakin/main/install.sh | BAKIN_VERSION=v1.0.0 bash
```

## Verify

```sh
bakin version
bakin --help
```

If the installer used `~/.local/bin`, make sure that directory is on your `PATH`.

## Alternatives

Manual release downloads and source builds are secondary paths. Contributor source setup is documented separately under [Contribute](/docs/contribute/overview/).
