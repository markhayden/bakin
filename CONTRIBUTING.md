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
git clone git@github.com:markhayden/bakin.git
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

1. **`bun run build:vendors`** — builds the import-map externals (React + `@bakin/sdk/*`) under `packages/host/public/vendor/`. Source of truth for specifier mapping: `scripts/build-vendors.ts` + `packages/host/public/index.html`'s `<script type="importmap">`. Keep those two in lockstep.
2. **`bun run build:plugins`** — *Phase E, #147.* Each `plugins/<id>/` builds to `plugins/<id>/dist/` with `react` + `@bakin/sdk/*` marked external.
3. **`bun run build:host-shell`** — `packages/host/` → `packages/host/dist/main.js` + `main.css`. Externalizes react + sdk.
4. **`bun build --compile`** — *Phase G, #147.* `dist/bakin-{darwin-arm64,linux-x64,linux-arm64}` single-file binaries.

Stage 1 must run before stages 3/4 so externals resolve at bundle time. Stages 2 and 3 are independent. Stage 4 requires all prior.

## Branch strategy

Work happens on feature branches (`issue-<N>-<short-slug>`) and merges to `main` via PR. See `CLAUDE.md` for commit-message conventions.

## Tests

All tests MUST mock `packages/core/src/content-dir` to use a temp directory. Never read or write to `~/.bakin/` during tests. See `CLAUDE.md` for full testing rules.
