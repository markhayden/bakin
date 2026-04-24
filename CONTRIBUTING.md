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
bun test --isolate
```

## Common commands

```bash
bun run dev          # watch mode: rebuild on change, hot-swap plugins in the browser
                     # (same as `bakin dev` — either form works)
bun run start        # one-shot prestart build + boot (production-style preview)
bun run server       # boot without rebuilding (use when dist/ is fresh)
bun run build        # full production build (ends with bun build --compile)
bun run typecheck    # tsc --noEmit
bun test --isolate   # full test suite
bun test --watch --isolate   # watch mode
bun run lint         # ESLint
```

## Development loop

`bun run dev` is what you use daily. It sets `BAKIN_DEV=1`, runs the same prestart build as `bun run start`, then starts a watcher coordinator + the server in the same process.

What it watches, and what happens when you save:

| You edit | What rebuilds | What the browser does |
|---|---|---|
| `packages/host/src/**` (.ts/.tsx/.css) | shell bundle | full reload (~2 s) |
| `plugins/<id>/` client source | that plugin only | hot-swap — the plugin subtree remounts, shell + other plugins + URL + scroll + SSE connection survive (~1.5 s) |
| CSS (via Tailwind's `--watch=always` child — any `.css` source or Tailwind-scanned `.tsx`) | — | swap the `<link>` tag's href, no reload (focus / input state preserved) |
| `packages/sdk/src/**` | vendor SDK bundles (`sdk-*.js`; `react*` untouched) | full reload (~3 s) |
| A plugin's `index.ts` (server entry) | nothing — v1 doesn't auto-restart the server | no-op; manually Ctrl-C and rerun `bun run dev` |
| `src/core/**`, `server.ts`, `scripts/**` | nothing — not watched | same; Ctrl-C + rerun |

A build error surfaces as a red overlay at the top of the viewport with the scope, message, and truncated stderr. The stale bundle keeps running underneath, so the app remains interactive while you fix it. The overlay clears on the next successful build.

The watcher writes the dev-client bundle to `packages/host/public/__bakin-dev/client.js` (gitignored, never embedded in the compiled binary). The binary's attack surface is identical to before — `/api/dev/events` and `/api/dev/notify` 404 whenever `BAKIN_DEV` is unset, regardless of code path.

For the architectural deep-dive (one-React-instance invariant, hot-swap mechanism, v3/v4/v5 deferrals), see [`.claude/knowledge/dev-loop.md`](./.claude/knowledge/dev-loop.md).

## Plugin devWatch

If your plugin has a non-standard layout, override the watcher's glob set via `bakin-plugin.json`:

```json
{
  "id": "my-plugin",
  "devWatch": ["client.tsx", "components/**", "hooks/**", "lib/**", "*.ts"]
}
```

Default when absent: `['client.tsx', 'components/**', 'lib/**', '*.ts']`. `index.ts` is always excluded from the client-side watcher (server-entry edits take the restart path). Invalid entries log a warning and fall back to the default.

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
