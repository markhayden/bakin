# HMR Dev Loop — Restore Fast Iteration After the Bun Migration

> **Status:** Draft — awaiting review
> **Related:** PR #148 (Bun migration, merged 2026-04-22), `.claude/specs/bun-migration.md`, `.claude/specs/plugin-client-ui-loader.md`
> **Target outcome:** `bun run dev` watches repo source, rebuilds incrementally, and in v2 hot-swaps plugin bundles without a full page reload.

## Problem

The Bun migration replaced Next.js's dev server (which gave us HMR for free) with a one-shot build pipeline. Today:

```
bun run start     # or `bun run dev` — they're identical today
  → bun run prestart
    → build:css
    → build:vendors
    → build:plugins
    → build:host-shell
    → build:assets-manifest
  → bun run server.ts
```

Every UI edit requires Ctrl-C, `bun run start`, then Cmd+Shift+R in the browser. 10–30 s of stop/rebuild/restart/refresh per save. Plugin authors (including the user) feel this most — iterating on a plugin component means reloading the whole app, losing scroll position, losing any open modals or form state, and re-fetching every bundle including ones that didn't change.

### Secondary problem: `bun run dev` currently lies

In `package.json`:

```json
"dev":   "bun run prestart && bun run server.ts",
"start": "bun run prestart && bun run server.ts",
```

Both do the same thing. `dev` is tech debt from the migration — a script named for an intent it no longer serves. This spec repurposes `dev` to mean "watch mode", per user expectation.

## Goals

1. **`bun run dev` watches the repo and surfaces changes in the browser without Ctrl-C.** Save a `.tsx` file in `packages/host/src/`, see the change in ~2 s.
2. **Plugin hot-swap.** Edit a plugin component, see the change without a full-page reload — shell stays mounted, zustand stores persist, URL and scroll position preserved.
3. **Production paths untouched.** `bun run build`, `bun build --compile`, `bakin start` binary — all unchanged. Dev mode is additive.
4. **No backwards-compat shims.** `dev` gets repurposed, old value deleted. Clean break.
5. **Isolation from runtime systems.** Source watcher must not collide with server.ts's content watcher on `~/.bakin/`. Separate chokidar instances, separate roots.
6. **One React instance invariant preserved.** Shell and every plugin share React via the import map. Every design decision below respects this — especially the plugin hot-swap path.
7. **Honest error surfacing.** Build failures render a browser overlay; stale bundles keep serving underneath so the user can see what *was* working.

## Non-goals

- **React Fast Refresh in v1 or v2.** Component-level state preservation (the `useState` values of the component you just edited survive the edit) is explicitly v3 territory. v2 does full *plugin* remount with a targeted `root.unmount()` + re-import — component state inside the edited plugin resets; everything else (shell, other plugins, URL, scroll, focus) persists.
- **Server-side code reload.** Editing `src/core/**`, `server.ts`, or any plugin's `index.ts` (server entry) does not live-reload the server in v1 or v2. Manual restart. Tracked as v4 follow-up.
- **Watch-mode typecheck / lint.** Editor LSP covers this.

## Tier plan

| Tier | Capability | Ships when |
|---|---|---|
| **v1** | Source watcher, per-scope rebuild, SSE reload channel, dev-error overlay, CSS link-swap (no reload), full-page reload for JS/TSX changes (shell + plugin + SDK) | First HMR PR |
| **v2** | Plugin hot-swap — per-plugin rebuild triggers targeted `unmount + re-import + remount`, no page reload. Shell / SDK / CSS paths unchanged from v1. | Second HMR PR (separate, stacked on v1) |
| **v3** (deferred, not specced here) | React Fast Refresh — `useState` preserved across a component edit. Requires a `Bun.plugin()` loader that runs `react-refresh/babel` on dev-only builds, plus `react-refresh/runtime` in the dev client, plus per-plugin boundary wiring. | Only if v2's plugin-level remount feels insufficient in practice |
| **v4** (deferred) | Server-side reload on `src/core/**` / `server.ts` / plugin `index.ts` edits. | When server iteration becomes the bottleneck |
| **v5** (deferred) | Dev-mode accessible over Tailscale (bind 0.0.0.0 instead of localhost, keep the dev SSE + HTML injection gated on `BAKIN_DEV`). Enables running OpenClaw on a separate machine and iterating on Bakin from the dev host against a real remote agent environment. | When cross-machine dev becomes routine |

v1 and v2 are both first-class in this spec; each has its own architecture section, acceptance criteria, and risk assessment. The v2 design is baked into v1's choices so shipping v2 doesn't require refactoring v1.

## Operating principles

Locked for this work, mirroring the bun-migration spec's style:

1. **Single-user Mac mini.** No multi-tenant, no auth, no remote-exposure hardening. Dev SSE endpoint is localhost-only in v1/v2; v5 widens the bind to LAN/Tailscale.
2. **Dev mode is opt-in via `bun run dev`.** Production entry points (`bakin start`, `bun run start`, `bun run server`) must not wire the watcher, the dev SSE route, or the HTML transform.
3. **One coordinator script.** `scripts/dev.ts` is the single entry point that spawns Tailwind's watcher, the repo-source watchers, and `server.ts`. No `concurrently`, no shell jobs, no make.
4. **Reuse the chokidar dep already in the tree.** No new dependencies for watching.
5. **No parallel SSE systems.** Dev reload channel is distinct from activity/audit to keep dev noise out of production — but uses the same SSE shape (not WebSockets) so the code surface stays small.
6. **Aggressive deletion.** `dev` gets its old value deleted, not aliased.

## Shared architecture (v1 + v2)

### Command surface

| Script | What it does | When to use |
|---|---|---|
| `bun run dev` | **NEW** — initial prestart-equivalent build, then spawns Tailwind `--watch`, chokidar watchers, and `server.ts` with `BAKIN_DEV=1`. | Daily iteration |
| `bun run start` | Unchanged — one-shot build + serve | Production-style preview |
| `bun run server` | Unchanged — skip build, serve existing `dist/` | Server-only iteration when `dist/` is fresh |
| `bun run build` | Unchanged — full production chain | Producing a binary |
| `bakin start` (compiled binary) | Unchanged — no watcher, no dev SSE route | Users running the shipped binary |

### Dev-mode toggle and route gating

- Env var: `BAKIN_DEV=1`.
- `scripts/dev.ts` sets it when spawning `server.ts`.
- Server registers `/api/dev/events` and `/api/dev/notify` *only* when the env is set. Belt-and-suspenders: the handlers themselves also reject requests when `BAKIN_DEV !== '1'`.
- `packages/host/src/api/_static.ts` injects the dev-client `<script>` into served `index.html` only when `BAKIN_DEV=1`. Committed `index.html` stays production-clean.

### File-by-file change set

**New (shared v1 + v2):**

- **`scripts/dev.ts`** — watcher coordinator. Spawns Tailwind `--watch` as child, owns the chokidar instances, triggers rebuilds, POSTs to `/api/dev/notify`.
- **`scripts/dev-build-one-plugin.ts`** — extracted `buildOne(id)` helper refactored out of `scripts/build-plugins.ts`. Called by `scripts/dev.ts` and reused by the existing batch builder. Pure refactor — batch builder remains green.
- **`packages/host/src/dev-client/client.ts`** — browser-side EventSource wiring. Compiled by `scripts/dev.ts` into a tiny standalone ESM (no React, no externals).
- **`packages/host/src/api/dev/events.ts`** — dev SSE handler.
- **`packages/host/src/api/dev/notify.ts`** — dev notify POST handler.
- **`.claude/knowledge/dev-loop.md`** — deep-reference doc for future agents.

**Modified (shared):**

- **`package.json`** — `"dev"` script repurposed; old value deleted.
- **`server.ts`** — register dev routes only when `BAKIN_DEV=1`.
- **`packages/host/src/api/_static.ts`** — inject dev-client `<script>` into `index.html` when `BAKIN_DEV=1`. Serve `/__bakin-dev/client.js` in dev.
- **`packages/host/src/api/plugins/manifest.ts`** — include a `version` field per plugin (source-mtime or content-hash). Needed by v2 for cache-busted re-imports. Added in v1 so the field exists when v2 starts using it.

### Watched roots and sub-builders

| Watch root | Sub-builder | Broadcast scope | v1 handler | v2 handler |
|---|---|---|---|---|
| `packages/host/src/**/*.{ts,tsx,css}` (excluding dev-client) | `bun run packages/host/build.ts` | `shell` | `location.reload()` | same — shell edits always full-reload |
| `plugins/<id>/<glob>` — glob resolved per-plugin (see *Per-plugin watch globs* below) | `buildOne(<id>)` (client only — server entry lives in index.ts) | `plugin:<id>` | `location.reload()` | `hotSwapPlugin(<id>)` |
| `plugins/<id>/index.ts` or `plugins/<id>/(hooks\|server/**)` | `buildOne(<id>)` server-side + mark "server-restart-required" flag | `plugin:<id>:server` | Overlay: "Server restart required — Ctrl-C and `bun run dev` again" | same — no auto-server-restart until v4 |
| `packages/sdk/src/**` | `bun run scripts/build-vendors.ts` (SDK bundles only — `react*` inputs unchanged, so byte-identical output) | `sdk` | `location.reload()` | `location.reload()` — SDK hot-swap would be a second-React-instance landmine (see *Risks*) |
| Tailwind output mtime (driven by `@tailwindcss/cli --watch` child) | — (child process writes the file) | `css` | link-tag swap, no reload | same |

Not watched (intentional in v1+v2):
- `src/core/**`, `src/lib/**`, `server.ts`, `scripts/**`, `tests/**`, `cli/**`, `dev/**`.

### Per-plugin watch globs

Plugin layouts vary — some have `hooks/`, some have `components/`, some keep shared utilities in `lib/`. Rather than lock a one-size glob into `scripts/dev.ts`, each plugin's `bakin-plugin.json` gets a new optional field:

```json
{
  "id": "tasks",
  "devWatch": ["client.tsx", "components/**", "hooks/**", "lib/**", "*.ts"]
}
```

- **Default** (when `devWatch` is absent): `['client.tsx', 'components/**', 'lib/**', '*.ts']`, with `index.ts` always excluded from the client-side watcher (server-entry edits take the server-restart path).
- **Override**: any plugin with a non-standard layout sets its own globs.
- **Scope**: `devWatch` globs are relative to the plugin's root directory. Standard globstar semantics.
- **Validation**: `scripts/dev.ts` reads each plugin's manifest on startup; an invalid glob or a field that references files outside the plugin root logs a warning and falls back to the default.

Wiring: `scripts/dev.ts` composes one chokidar watcher per plugin rather than one big watcher with complex ignore patterns. Chokidar is already cheap enough that 10 watchers on narrow subtrees is fine.

Documented in `docs/plugin-authoring.md` as part of the v2 rollout.

### Dev SSE event shape

One event type across v1 + v2. v1 clients ignore `hot-swap` and treat it as `reload`.

```ts
type DevEvent =
  | { type: 'dev:ready' }                                     // on connect
  | { type: 'dev:building', scope: DevScope }                 // rebuild started
  | { type: 'dev:css' }                                       // link-tag swap
  | { type: 'dev:reload', scope: DevScope }                   // full page reload
  | { type: 'dev:hot-swap', scope: 'plugin', id: string,      // v2 only
      version: string }
  | { type: 'dev:error', scope: DevScope, message: string,
      stderr?: string }
  | { type: 'dev:recover', scope: DevScope }                  // clears error overlay

type DevScope = 'shell' | 'plugin' | 'sdk' | 'css' | 'server'
```

The `version` field on `hot-swap` is a content hash or mtime from the just-finished rebuild. The dev client uses it as the `?v=` cache-buster on the re-import URL.

### Debouncing + coalescing

- Each watcher: 50 ms trailing-edge timer. Calibrated for Zed / Cursor (which save immediately on Cmd+S with no editor-side write-delay). VS Code's ~200 ms formatOnSave gap would still coalesce fine; a lower debounce is only visible to editors that save faster than VS Code, which is most of them.
- Rapid saves (e.g., "Save All" across 3 files) coalesce to one rebuild.
- Scope-level queue: if a rebuild is in flight, a new change to the same scope queues exactly one follow-up. No unbounded pile-up.
- Different scopes rebuild in parallel (shell + plugin build can run concurrently).

### Error surfacing

- `scripts/dev.ts` captures subprocess stderr on build failure, POSTs `{ type: 'dev:error', scope, message, stderr }`.
- Dev client renders a fixed-position red overlay at top of viewport. `white-space: pre`, monospace, click-to-dismiss.
- Stale bundles remain served — the browser shows the last-working state with the error banner on top.
- `dev:recover` removes the overlay. Next successful rebuild emits it automatically.

### Dev-client HTML injection

`_static.ts` currently serves `index.html` via `sendEmbedded(res, '/index.html')` or `sendDiskFile`. New behavior:

```ts
if (process.env.BAKIN_DEV === '1' && url.pathname === '/' /* or SPA fallback */) {
  // read the html bytes, inject before </body>:
  //   <script type="module" src="/__bakin-dev/client.js"></script>
  // serve with Cache-Control: no-cache
}
```

Env-gated, one code path. When `BAKIN_DEV` is unset, the transform never runs and the binary serves embedded bytes unchanged.

### Dev SSE channel isolation

- Separate route: `/api/dev/events` (SSE).
- Separate client set held in the dev-SSE module, not in `src/core/sse.ts`. No changes to production SSE code.
- Separate `EventSource` on the browser side. Plugins' activity feeds that connect to `/api/events` are unaffected.

## v1 — Live-reload

### Behavior

- Save a shell file → full page reload within ~2 s.
- Save a plugin file → only that plugin rebuilds, then full page reload within ~2 s.
- Save a CSS-triggering file → Tailwind rebuilds, browser swaps `<link>` href without reload within ~1 s.
- Save an SDK file → SDK vendor bundles rebuild, browser fully reloads within ~3 s.
- Save a plugin's `index.ts` (server entry) → overlay telling the user to restart (no auto-restart in v1).
- Build error → overlay appears; stale bundle keeps serving; fix error → overlay clears + reload.

### One React instance — how v1 preserves it

- Vendor bundles (`react.js`, `react-dom.js`, `jsx-runtime.js`, `jsx-dev-runtime.js`, `tanstack-router.js`) are never rewritten by the dev watcher. Nothing under `packages/host/src/`, `plugins/`, or `packages/sdk/src/` touches those files. SDK rebuilds regenerate only `sdk-*.js`.
- On any `dev:reload`, the browser calls `location.reload()`. React, DOM, router — everything tears down. Next load creates one fresh React instance via import map.
- CSS swap doesn't touch JS. React state is preserved because nothing in JS is touched.

### v1 dev-client state machine

```
  [idle] --dev:building--> [rebuilding] --dev:reload--> location.reload()
                                        --dev:css-----> [swapping] --done--> [idle]
                                        --dev:error---> [error] --dev:recover--> [idle]
```

~150 LoC of plain ESM in `packages/host/src/dev-client/client.ts`.

### v1 acceptance criteria

1. `bun run dev` (clean clone): completes initial build, server ready, browser loads the app, dev-client EventSource visible in Network tab.
2. **Shell edit.** Add a visible string to `packages/host/src/components/layout/header.tsx`. Save. Browser reloads within 2 s; new string visible.
3. **Plugin edit.** Change a label in `plugins/tasks/components/board.tsx`. Save. Browser reloads within 2 s; new label visible. `plugins/tasks/dist/client.js` rewritten; other plugin dists' mtimes unchanged.
4. **CSS edit.** Add a utility class usage to any `.tsx`. Save. Within 1 s, styles update *without reload* — verify by typing in an input beforehand and confirming its text survives.
5. **SDK edit.** Add a comment in `packages/sdk/src/hooks/use-query-state.ts`. Save. Browser reloads within 3 s. `react.js` mtime unchanged.
6. **Server-entry edit.** Change something in `plugins/tasks/index.ts`. Save. Overlay appears: "Server restart required — Ctrl-C and `bun run dev` again." No crash, no reload.
7. **Error case.** Introduce a syntax error in `packages/host/src/main.tsx`. Save. Red overlay appears within 2 s. App below still responds to clicks. Fix error. Overlay clears; reload.
8. **Production untouched.** `rm -rf packages/host/dist packages/host/public/vendor plugins/*/dist`; `bun run start`. App loads. `curl -i http://localhost:3737/api/dev/events` → 404.
9. **Binary.** `bun run build`; `./dist/bakin-darwin-arm64 start`. App loads. `/api/dev/events` → 404.
10. **Isolation.** Touch a file in `~/.bakin/projects/` while `bun run dev` is running — content watcher fires, no rebuild happens. Save a file in `packages/host/src/` — content watcher does not fire.
11. **Latency p95 over 5 saves:** CSS ≤ 1000 ms, shell ≤ 2000 ms, plugin ≤ 1500 ms.

## v2 — Plugin hot-swap

### Why this tier exists

v1 makes plugin edits survivable, but still reloads the whole page on every plugin save. For plugin authors (which is every active contributor right now), losing shell state — sidebar scroll, open accordions, zustand-held filter state, the currently-active view in a stacked React Router tree, any open dialog on the *shell* that the plugin isn't responsible for — on every save is a sizable tax. v2 removes it.

### What hot-swap means here (not Fast Refresh)

**In scope:** re-import the changed plugin's client bundle, unmount the plugin's subtree, re-mount from the fresh module. Shell, other plugins, SDK, vendor bundles — untouched.

**Out of scope (still v3 territory):** preserving `useState` inside an edited component. When a plugin reloads in v2, that plugin's components start fresh. Component state in *other* plugins, and all shell state, persists.

This is a deliberate middle tier. It captures ~70% of the state-preservation value at ~15% of the engineering cost compared to full Fast Refresh, and it doesn't introduce a React-internals runtime we'd have to maintain.

### The module-identity problem and how v2 handles it

The concern flagged in the kickoff: `import(pluginClientUrl)` captures a module instance. Re-importing after rebuild creates a *second* instance — old React-tree nodes still reference the first one, so naive re-import leaves dangling references.

v2's approach works because we don't try to swap in-place. We *unmount first*:

1. Dev watcher rebuilds plugin `<id>`.
2. Watcher broadcasts `{ type: 'dev:hot-swap', id: <id>, version: <hash> }`.
3. Dev client:
   a. Drops nav/slot registry entries owned by plugin `<id>` (the `registerPlugin` + `registerSlot` API already keys by plugin id — the registry has a cleanup call added for this).
   b. Forces a re-render of the shell so nav items/slots from the old plugin disappear from the tree. React naturally unmounts the subtrees that rendered those entries.
   c. Dynamic-imports `/api/plugins/<id>/assets/client.js?v=<hash>`. New module instance runs `registerPlugin` with the new exports.
   d. Forces another re-render; nav/slots from the new module appear in the tree, React mounts them.
4. Done. Shell React tree stayed mounted throughout. Vendor bundles never refetched. Other plugins untouched.

No old module references linger because React unmounted the subtrees that held them. The old module object itself stays in the browser's module cache keyed by the old URL — that's a small memory leak proportional to (plugin size × edits). For a 200 KB plugin across 1000 saves, ~200 MB. Acceptable for a dev session; if it ever hurts, reload the page manually.

**One React instance** is still preserved: every module import of `'react'` resolves via the import map to `/vendor/react.js`, which has been in the browser since the first page load and is not rebuilt. Old module + new module both reference the same React.

### Changes v2 adds on top of v1

**Registry-side (`@bakin/sdk/register`):**

- New API: `unregisterPlugin(pluginId: string)` — removes that plugin's nav items, slots, exec tools, any other registry entries keyed by plugin id. Idempotent.
- New API: `getRegistryVersion()` — returns a number that increments on every register/unregister. Shell subscribes to this to re-render when plugins come/go.

**Shell-side (`packages/host/src/plugin-host/PluginHost.tsx`):**

- Subscribes to `getRegistryVersion()` so a plugin register/unregister triggers a shell re-render (nav + slots refresh).
- Exports an imperative handle `hotSwapPlugin(pluginId, clientEntryUrl)` used by the dev client.

**Dev client (`packages/host/src/dev-client/client.ts`):**

- New handler for `dev:hot-swap` events. Calls `unregisterPlugin(id)` → forces re-render → `import(clientEntryUrl + '?v=' + version)` → done.
- Falls back to `location.reload()` if hot-swap throws (e.g., the new module fails to execute).

**Manifest route (`packages/host/src/api/plugins/manifest.ts`):**

- Already modified in v1 to include `version` field. v2 starts consuming it. No additional route changes.

### v2 acceptance criteria

All v1 criteria continue to pass, plus:

1. **Plugin hot-swap.** Open the app, navigate to the tasks view, scroll the task list, open a detail dialog on some task. Edit `plugins/tasks/components/board.tsx` — change a label. Save. Within 1.5 s:
   - The tasks subtree re-renders with the new label.
   - Scroll position is preserved.
   - The detail dialog closes (it was part of the tasks subtree that just remounted) — acceptable.
   - The *sidebar* stays in its current scroll position (shell not remounted).
   - The SSE activity feed keeps ticking (never disconnected).
   - No full page reload — verify with a `performance.timing.navigationStart` check in console before and after.
2. **Cross-plugin isolation.** Open the tasks view, then navigate to the workflows view, then back. Edit a tasks component. Only tasks refreshes — the workflows plugin's module instance (in the browser's module cache) is unchanged. Verify in devtools Network: only one new request for tasks' `client.js?v=<hash>`.
3. **Hot-swap fallback.** Introduce a runtime error in the new plugin module (e.g., `throw new Error()` at module top-level). Save. Within 2 s, the dev client falls back to `location.reload()` + renders the error overlay from the subsequent failed load. App recovers when the error is fixed.
4. **Server-entry edit (unchanged from v1).** Still requires manual restart. Overlay still tells the user.
5. **Shell edit (unchanged from v1).** Still full page reload. Shell hot-swap is not a goal — the shell is infrastructure and rarely iterated on.
6. **Memory.** After 100 consecutive edits to the same plugin, the browser tab's heap growth (DevTools > Memory > heap snapshot, compared to a fresh session) is < 100 MB. Growth beyond that is a signal the registry cleanup is leaking, not passive module caching — fix the leak before shipping, don't just raise the cutoff.
7. **Safety valve.** After every 100 hot-swaps in a session, the dev client forces a `location.reload()` to clear the browser's ES module cache. User-facing behavior: one extra reload per ~100 saves of the same plugin — unnoticeable in practice, bounds the leak in the worst case.

### How hot-swap actually affects browser memory (for context on the cutoffs above)

The leak mechanism: ES modules in the browser are cached by URL. Every hot-swap imports from `client.js?v=<hash>` with a new `<hash>`, so every edit adds a new cache entry — there is no `import.cache.delete()` API to evict old ones. Each cached entry holds the compiled bytecode of the plugin bundle (roughly 150–400 KB for a core plugin, depending on size).

Two components to the memory growth:

1. **Passive module bytecode caching** — unavoidable. 100 edits × ~400 KB ≈ 40 MB. Fine.
2. **Leaked closures** — the risk. If the old module's exported functions are still referenced from anywhere (registry entries not cleaned up, lingering event listeners, zustand store subscriptions), the whole module's closure stays live. Each edit then pins another copy of (bytecode + closure + any captured state). This is what blows through the 100 MB cutoff.

The 100 MB cutoff = "passive caching budget + 50% headroom". If we exceed it, something in the unregister path is broken, and v2 should not ship until it's fixed. The 100-swap safety valve handles the pathological case where a specific plugin retains some state we haven't accounted for.

### v2 risks

1. **Registry cleanup incomplete.** If `unregisterPlugin(id)` misses an entry (e.g., an exec tool registered by a plugin isn't removed), the old module's closure stays referenced and never GCs — hot-swap becomes a real memory leak. Mitigation: the SDK registry is small (nav, slots, exec tools, skills, workflows, node types, notification channels, hooks). Every registration API gets a paired unregister keyed by plugin id. Audit checklist included in the plan.
2. **Imperative hot-swap handle escapes dev.** If `hotSwapPlugin` leaks into production bundles via a bad import graph, it'd be a DX-only code path in production. Mitigation: behind `process.env.BAKIN_DEV` check at the call site (dev client) and `import.meta.env` or module-level dead-code elimination. Production builds shouldn't contain the hot-swap runtime.
3. **Plugin-side state that was in the React tree doesn't survive.** This is intentional — v2 is "remount the plugin", not Fast Refresh. Document clearly so plugin authors don't expect `useState` to survive hot-swap. If this hurts enough, v3.
4. **Dev watcher rebuilds and emits `hot-swap` faster than the browser can import the new module.** Mitigation: dev client debounces its own `hot-swap` handler so multiple rapid events collapse to a single unmount+remount using the latest version string.
5. **The old module's `registerPlugin` side effects aren't fully reversible.** Specifically: if a plugin's `client.tsx` does anything at module-load time that can't be undone (e.g., attaches a global event listener on `window`), hot-swap leaves that side effect lingering. Mitigation: document the contract — plugin client-side module-load side effects must be confined to `registerPlugin` / `registerSlot` / `registerNodeType` / etc. APIs that have matching unregister paths. Audit the 10 core plugins for stray `window.addEventListener` / similar on module load before shipping v2.

## Answers to the open questions from the kickoff

| Question | Answer |
|---|---|
| Level of HMR? | v1 = live-reload everywhere. v2 = plugin hot-swap (targeted remount, no page reload). v3 = React Fast Refresh (deferred). |
| What triggers a rebuild? | `packages/host/src/**` (shell), `plugins/<id>/(client.tsx\|components/**\|lib/**\|*.ts)` (per-plugin), `packages/sdk/src/**` (SDK vendor bundles only). `src/**`, `server.ts`, plugin `index.ts` server entries not watched — manual restart. |
| Signal channel? | Dedicated `/api/dev/events` SSE endpoint, separate from `/api/events`. Plain SSE — no WebSockets. Isolated from `src/core/sse.ts`. |
| Command surface? | `dev` repurposed to watch mode. `start`/`server` unchanged. `bakin start` binary unchanged. |
| HTML injection? | `_static.ts` transforms served `index.html` to add dev-client script when `BAKIN_DEV=1`. Committed HTML stays prod-clean. |
| Plugin HMR granularity? | v1 = full reload on plugin change. v2 = per-plugin remount with `unregisterPlugin(id)` → re-import → registry re-populates. |
| Debounce? | 50 ms trailing-edge per watcher (calibrated for Zed / Cursor fast-save). Targets: <1 s CSS, <2 s shell, <1 s (v1) / <1.5 s (v2) plugin. |
| Error surfacing? | Red monospace overlay via the dev SSE channel. Stale bundles keep serving underneath. |
| Resource cost? | Minimal. Tailwind child + 2–3 chokidar watchers + short-lived builds. |

## Testing strategy

**v1:**

- Unit test for `_static.ts` HTML-transform: injects when `BAKIN_DEV=1`, no-op when unset (bytes byte-equal to input).
- Integration test for `/api/dev/events` gate: 404 when `BAKIN_DEV` unset, functional when set.
- No tests for the watcher script itself — single-user tool, the feedback loop is the test.

**v2:**

- Unit tests for `@bakin/sdk` registry unregister paths: after `unregisterPlugin('tasks')`, nav items, slots, exec tools, skills, workflows, node types, notification channels, and hooks owned by tasks are all gone. Re-registration works afterward.
- Integration test for `hotSwapPlugin` in PluginHost: mount shell with mock manifest, call `hotSwapPlugin('x', '/path?v=1')` with a fake dynamic import that resolves → assert re-render happened, registry has new entries, old ones gone.
- No browser-automation test for the full save-to-DOM cycle. Manual acceptance per criteria above.

**Regression check (both tiers):**

- `bun run start` flow (production preview) still smoke-passes: load app, verify all 10 plugins mount, verify activity feed.

## Documentation impact

- **`README.md`:** add `bun run dev` to "Getting Started".
- **`CONTRIBUTING.md`:** rewrite the dev-loop section. Call out v1 (save = reload) and v2 (plugin save = hot-swap) behavior clearly. Note that server-side code (plugins' `index.ts`, `src/core/**`, `server.ts`) still requires manual restart.
- **`CLAUDE.md`:** update "Architecture" with a `bun run dev` note. Update the command-surface description (`dev` now differs from `start`).
- **`.claude/knowledge/dev-loop.md`:** new deep-reference doc. Covers watcher architecture, one-React-instance invariant in dev, isolation guarantees, v2 hot-swap mechanism (including registry cleanup contract), the v3 deferral rationale.
- **`docs/plugin-authoring.md`:** add a "Dev-mode contract" paragraph — plugin client-side module-load side effects must be confined to the documented register APIs; raw `window.addEventListener` or similar on module load will leak across hot-swaps.

## Out-of-scope follow-ups

- **v3: React Fast Refresh.** Component-level state preservation. Requires `Bun.plugin()` loader for `react-refresh/babel` transform (dev only), `react-refresh/runtime` in the dev client, per-plugin boundary wiring. Revisit after v2 lives for a few weeks.
- **v4: Server-side reload.** Edit `src/core/**`, `server.ts`, or a plugin's `index.ts`, server reloads without Ctrl-C. Requires either switching to `Bun.serve` (which supports `--hot`) or a supervisor wrapper. Tracked separately.
- **v5: Dev over Tailscale / LAN.** Today v1/v2 bind localhost only, which assumes Bakin and OpenClaw run on the same machine (as they do today). Widening the dev-mode bind to 0.0.0.0 — keeping the `BAKIN_DEV` gate on the dev SSE + HTML injection — would let OpenClaw run on a separate box (isolated, possibly more powerful host) while the Mac mini drives Bakin dev with HMR. Non-trivial for only one reason: the dev SSE channel, the notify POST, and the dev-client script are currently "trusted because localhost"; exposing them over LAN means at minimum adding an auth token pair set by `scripts/dev.ts` and checked by the dev handlers. Big-win follow-up, not required for v1/v2.
- **Dev-mode rebuild profiling.** Surface timings in the overlay ("shell rebuilt in 1.4 s") to catch latency regressions.
- **HMR for defaults content.** Editing a plugin's `defaults/workflows/*.yaml` or `workflow-skills/*.md` currently requires a registry refresh. Could piggyback on plugin hot-swap.
- **Watch-mode typecheck banner.** Overlay TS errors alongside build errors.

## Commit / PR strategy

One branch, one PR, commits as rollback checkpoints. v1 is usable after commit 5; v2 is usable after commit 8. Order designed so each commit either lands a complete scaffold piece or unlocks a user-observable capability — no "half-scaffolded, broken in between" states.

```
1. chore(dev): extract buildOne(id) from build-plugins.ts
   — Refactor only. Batch builder still works. No behavior change.

2. feat(dev): add BAKIN_DEV-gated /api/dev/{events,notify} routes
   — Server-side scaffold. Routes exist, 404 when BAKIN_DEV unset.

3. feat(dev): inject dev-client script into index.html when BAKIN_DEV=1
   — _static.ts HTML transform. No dev-client file yet; the injected
     <script> 404s, which is fine — nothing uses it.

4. feat(dev): scripts/dev.ts watcher coordinator (v1 live-reload skeleton)
   — Watchers + rebuilds wired. Dev client is a stub that logs events.
     Shell / plugin / SDK reload works.

5. feat(dev): CSS link-swap + error overlay (v1 complete)
   — Dev client grows CSS hot-swap + overlay. v1 usable in anger.

6. feat(sdk): add unregisterPlugin + getRegistryVersion APIs
   — SDK-level change. Existing plugins unaffected (the APIs are
     additive; nothing calls them yet).

7. feat(dev): PluginHost subscribes to registry version, exposes hotSwapPlugin
   — Shell becomes hot-swap-capable. Still no UI-visible change —
     nothing invokes hotSwapPlugin yet.

8. feat(dev): plugin hot-swap path in dev-client (v2 complete)
   — Dev client calls hotSwapPlugin on dev:hot-swap events. v2 usable.

9. docs: CONTRIBUTING, CLAUDE.md, docs/plugin-authoring.md,
        .claude/knowledge/dev-loop.md
   — Documentation pass. Covers v1 + v2 behavior, plugin devWatch field,
     the "module-load side effect" contract for plugin authors.
```

**Rollback math:** reverting commit 8 → back to v1 (hot-swap disabled, plugin edits fall through to full reload via the v1 handler). Reverting commits 6–8 → back to v1. Reverting commits 4–8 → no dev mode at all (scaffold routes exist but nothing triggers them; `bun run dev` still works because it only runs after commit 4). Reverting commit 1 → everything else still works (the refactor is isolated).

## Open questions for review

(None that block planning. Listed here for the reviewer to push back on if wanted.)

- **Dev-client path.** `/__bakin-dev/client.js` — double-underscore prefix to signal "infrastructure, not user content." Kept as-is pending review.
