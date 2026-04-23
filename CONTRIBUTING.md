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

## Build pipeline order

`bun run build` runs these stages in sequence:

1. **`bun run build:css`** — compiles the Tailwind v4 source at `packages/host/src/globals.css` to `packages/host/public/globals.css` via `@tailwindcss/cli`.
2. **`bun run build:vendors`** — builds the import-map externals (React, `@tanstack/react-router`, `@bakin/sdk/*`) under `packages/host/public/vendor/`. Source of truth for specifier mapping: `scripts/build-vendors.ts` + `packages/host/public/index.html`'s `<script type="importmap">`. Keep those two in lockstep.
3. **`bun run build:plugins`** — each `plugins/<id>/` builds to `plugins/<id>/dist/` with `react`, `@tanstack/react-router`, and `@bakin/sdk/*` marked external.
4. **`bun run build:host-shell`** — `packages/host/` → `packages/host/dist/main.js`. Externalizes react, tanstack-router, and sdk.
5. **`bun run build:assets-manifest`** — regenerates `packages/host/src/api/_embedded-assets-static.ts` from whatever's currently on disk under `public/`, `public/vendor/`, and `plugins/<id>/dist/`.
6. **`bun build --compile`** — produces `dist/bakin-{darwin-arm64,linux-x64,linux-arm64}` single-file binaries with every asset from step 5 embedded.

Stages 1–2 must run before stages 4/6 so externals resolve at bundle time. `bun run start` chains 1–5 before booting `server.ts`, so a fresh checkout works with `bun run start` alone — no manual build sequence needed. Use `bun run server` to skip the build chain when iterating and you know assets are current.

## Branch strategy

Work happens on feature branches (`issue-<N>-<short-slug>`) and merges to `main` via PR. See `CLAUDE.md` for commit-message conventions.

## Tests

All tests MUST mock `packages/core/src/content-dir` to use a temp directory. Never read or write to `~/.bakin/` during tests. See `CLAUDE.md` for full testing rules.
