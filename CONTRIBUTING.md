# Contributing to Bakin

## Prerequisites

Bakin is built on [Bun](https://bun.sh) — a unified runtime + bundler + package manager.

- **Bun:** `>= 1.2.0` (pinned in `.bun-version`)
- **Git**

Install Bun (macOS / Linux):

```bash
curl -fsSL https://bun.sh/install | bash
# or via Homebrew:
brew install oven-sh/bun/bun
```

Verify:

```bash
bun --version   # >= 1.2.0
```

No Node.js, pnpm, yarn, or Vite installation required — Bun handles everything Bakin needs.

## First-time setup

```bash
git clone git@github.com:madeinwyo/bakin.git
cd bakin
bun install
bun run typecheck
bun x vitest run
```

## Common commands

```bash
bun run dev          # start Bakin in dev mode
bun run build        # production build
bun run typecheck    # tsc --noEmit
bun x vitest run     # full test suite
bun x vitest watch   # watch mode
bun run lint         # ESLint
```

## Build pipeline order (post-migration to Bun)

`bun run build` runs these stages in sequence:

1. **Vendor bundles** — build `/vendor/react.mjs`, `/vendor/react-dom.mjs`, `/vendor/sdk/*.mjs`
2. **Host shell** — `packages/host/` builds to `packages/host/dist/`
3. **Core plugins** — each `plugins/<id>/` builds to `plugins/<id>/dist/`
4. **Binary** — `bun build --compile` packages everything into `dist/bakin-<platform>`

## Branch strategy

Work happens on feature branches (`issue-<N>-<short-slug>`) and merges to `main` via PR. See `CLAUDE.md` for commit-message conventions.

## Tests

All tests MUST mock `packages/core/src/content-dir` to use a temp directory. Never read or write to `~/.bakin/` during tests. See `CLAUDE.md` for full testing rules.
