# Bakin'

<p align="center">
  <img src=".github/assets/welcome-main-image.webp" alt="Bakin" width="400" />
</p>

<p align="center"><em>Bakin' sits on top of your agent runtime, like <a href="https://openclaw.ai/">OpenClaw</a> or <a href="https://pi.dev/">Pi</a>, and turns raw agent execution into a visible, collaborative, productive operating layer with tasks, schedules, workflows, memory, observability, and extension points you can adapt to the way your team actually works.</em></p>

<p align="center">
  <a href="https://github.com/markhayden/bakin/actions/workflows/ci-main.yml"><img src="https://img.shields.io/github/actions/workflow/status/markhayden/bakin/ci-main.yml?branch=main&style=for-the-badge&label=build" alt="Build" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.3.13-black?style=for-the-badge" alt="Bun ≥ 1.3.13" />
</p>

---

It gives teams a self-hosted dashboard, backend, CLI, and plugin system for managing tasks, schedules, assets, brands, workflows, memory, models, health checks, automation, and direct agent chat.

The product is local-first: Bakin' owns its data under `~/.bakin/`, talks to the configured runtime through adapters, and serves the browser UI from one Bun-powered process.

## Install

Install the current release candidate:

```sh
curl -fsSL https://raw.githubusercontent.com/markhayden/bakin/main/install.sh | BAKIN_VERSION=v0.0.1-rc.20 bash
```

The installer uses `/usr/local/bin` when it can write there, otherwise it falls back to `~/.local/bin`. If `bakin` is not found after install, add the fallback directory to your `PATH`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Then onboard and start:

```sh
bakin onboard
bakin start
```

Open [http://localhost:3737](http://localhost:3737).

## Running Bakin'

```sh
bakin start        # start in the foreground
bakin stop         # stop a running Bakin process
bakin restart      # stop, then start again
bakin status       # show server, dispatch, and health status
bakin doctor       # run health checks now
```

The server listens on port `3737` by default. Set `PORT` to run it somewhere else:

```sh
PORT=4000 bakin start
```

## Update

```sh
bakin update
```

`bakin update` replaces the current binary with the latest release and verifies the checksum before installing it.

Full install, setup, operation, update, and troubleshooting docs live at [makinbakin.com/docs](https://makinbakin.com/docs/).

## Docs

- [Install Bakin](https://makinbakin.com/docs/start/install/)
- [Initial Setup](https://makinbakin.com/docs/start/first-time-setup/)
- [Daily Operation](https://makinbakin.com/docs/start/operation/)
- [Using Bakin](https://makinbakin.com/docs/using/essentials/)
- [Make Bakin Yours](https://makinbakin.com/docs/extending/overview/)
- [Build a Plugin](https://makinbakin.com/docs/extending/plugins/build/)
- [SDK](https://makinbakin.com/docs/extending/sdk/overview/)
- [CLI Reference](https://makinbakin.com/docs/reference/generated/cli/)
- [API Reference](https://makinbakin.com/docs/reference/generated/api/)
- [Data and Security](https://makinbakin.com/docs/security/data-and-security/)

## Repository Map

```text
cli/                 CLI entry point for source-tree runs
docs/                Public documentation site source
packages/core/       Shared runtime types, settings, adapters, hooks, and utilities
packages/host/       Browser shell, API handlers, and plugin host
packages/sdk/        Public plugin-author SDK, published as @makinbakin/sdk
plugins/             First-party plugins that ship with Bakin
scripts/             Build, release, docs generation, and infrastructure scripts
src/                 Server-side subsystems and CLI implementation
dev/                 Local development helpers, mocks, and Docker runtime setup
skill/               Runtime-agent skill for interacting with Bakin
```

For source setup and contribution workflow, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Development

```sh
git clone git@github.com:markhayden/bakin.git
cd bakin
bun install
bun run dev
```

Useful checks:

```sh
bun run typecheck
bun run test
bun run docs:check
```

The detailed development loop, generated docs workflow, plugin authoring path, and review expectations are documented in [Bakin' Core](https://makinbakin.com/docs/extending/development-workflow/) and [Quality Control](https://makinbakin.com/docs/extending/quality-control/).

## License

Apache-2.0
