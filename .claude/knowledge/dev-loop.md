# Dev Loop — Deep Reference

How `bun run dev` works under the hood. Reference for future work on the
dev experience or on anything that touches the plugin registry,
`_static.ts`, or the dev SSE channel. Canonical reference (the originating
spec/plan shipped and were retired).

## Tiers

v1 (live-reload) and v2 (plugin hot-swap) both ship today. The user-
visible difference is what happens when you save a plugin file:

- **v1 behavior (retained for shell / SDK / CSS):** save a file → full
  page reload (or link-tag swap for CSS). Everything mounts fresh.
- **v2 behavior (core plugin client files):** save a core plugin client
  file under `plugins/<id>/` → only that plugin's client subtree
  remounts. Shell (sidebar, routing, zustand stores), other plugins,
  URL, scroll position, focus, the `/api/events` SSE connection — all
  survive.
- **v2 behavior (linked user plugins):** save a linked plugin file under
  its source tree → Bakin rebuilds the plugin, hot-swaps server
  registrations in-process, then remounts that plugin's client bundle.
  This is the path used by `bakin plugins link <path>`.

Not yet shipped:

- **v3 (deferred):** React Fast Refresh — preserve `useState` across a
  component edit. Requires a `Bun.plugin()` loader for
  `react-refresh/babel` + the runtime hooked into every plugin bundle.
  Revisit if v2's "plugin-wide remount" feels insufficient in practice.
- **v4 (deferred):** server-side reload on `src/core/**`, `server.ts`,
  and core plugin `index.ts` edits. Today requires manual Ctrl-C +
  rerun. Linked user plugin server entries already reload through the
  hot-reload coordinator.
- **v5 (deferred):** LAN/Tailscale-accessible dev mode so OpenClaw can
  run on a separate machine. Would need auth-token gating on
  `/api/dev/{events,notify}`.

## Architecture

```
bun run dev
    │
    ▼
scripts/dev.ts (process.env.BAKIN_DEV = '1', BAKIN_DEV_HOTRELOAD = '1')
    │
    ├── Sets BAKIN_CONSOLE_FORMAT=pretty by default
    │     • `bakin dev --verbose` switches to verbose console logs
    │     • `bakin dev --no-color` sets NO_COLOR=1
    ├── Initial prestart build (css, vendors, plugins, host-shell)
    ├── Bun.build(dev-client.ts → public/__bakin-dev/client.js)
    ├── Spawn bun node_modules/.bin/tailwindcss --watch=always   (child process)
    ├── chokidar watchers:
    │     • packages/host/src/**         → rebuild shell → dev:reload
    │     • plugins/<id>/<devWatch>       → rebuildOnePlugin(id) → dev:hot-swap
    │     • packages/sdk/src/**           → rebuild vendors → dev:reload
    │     • public/globals.css mtime      → dev:css
    └── await import('../server')  ← boots HTTP + MCP + SSE + content watcher
          │                            in the same process; starts linked
          │                            plugin hot-reload coordinator;
          │                            broadcastDev()
          │                            writes directly to the dev SSE client
          │                            Set (no HTTP round-trip)
          ▼
    /api/dev/events (SSE)  ←────── dev client's EventSource connects here
                                    (404 when BAKIN_DEV unset)

Browser:
    packages/host/public/index.html  (_static.ts injects dev-client script
                                       before </body> when BAKIN_DEV=1)
        │
        ├── /_app/main.js     (shell bundle)
        ├── /vendor/*.js       (react, tanstack-router, @makinbakin/sdk/*)
        ├── /__bakin-dev/client.js   (dev client — dev-only, disk-only)
        └── /api/plugins/<id>/assets/client.js   (each plugin's bundle)

    Dev client:
        EventSource('/api/dev/events')
            on 'dev:css'      → <link> swap with cache-bust
            on 'dev:reload'   → location.reload()
            on 'dev:hot-swap' → window.__bakinHotSwapPlugin(id, url, version)
            on 'dev:error'    → render red overlay
            on 'dev:recover'  → dismiss overlay
```

The core plugin set the dev watcher (and `scripts/build-plugins.ts`)
iterates comes from ONE place: `CORE_PLUGIN_IDS` in
`src/lib/core-plugin-ids.ts`. The scripts previously kept hand-maintained
copies with different orderings — adding a plugin had to be threaded into
each by hand, and a miss silently dropped it from one build path. An
architecture test (`tests/architecture/core-plugin-ids.test.ts`) pins the
list to the keys of `CORE_PLUGIN_IMPORTS` (the set the binary embeds).

## Gates (defense in depth)

Three env-checks ensure `BAKIN_DEV` never leaks into the compiled binary:

1. **`scripts/dev.ts`** is the only place that sets `process.env.BAKIN_DEV = '1'`. The compiled binary never runs this script; the `bakin start` entry point goes straight through `server.ts`.
2. **Handlers** at `packages/host/src/api/dev/{events,notify}.ts` both return 404 when `BAKIN_DEV !== '1'`.
3. **`_static.ts`'s `transformIndexHtmlForDev`** is a no-op (returns the input `Buffer` by reference) when `BAKIN_DEV !== '1'`. No dev-client script tag. Verified by `tests/api/host-static.test.ts`.

The dev-client bundle itself is disk-only — written to `packages/host/public/__bakin-dev/client.js`, gitignored, naturally excluded from `scripts/generate-embedded-assets.ts` (which only descends into explicitly-walked subdirectories under `public/`). It can never ship in a compiled binary.

## Shutdown ordering (#459)

`scripts/dev.ts` registers SIGINT/SIGTERM handlers **before** `await import('../server')`, and signal listeners run in registration order — so the dev handler always fires first. The rules live in `scripts/dev-shutdown.ts` (`registerDevShutdown`, DI-tested in `tests/scripts/dev-shutdown.test.ts`):

- **Build phase (sole listener):** the dev handler kills the tailwind child and owns `process.exit(0)` — Ctrl+C during the prestart builds exits promptly.
- **After server boot:** `lifecycle.registerShutdownHandlers()` has added its own listener on the same signals. The dev handler detects this via `process.listenerCount(signal) > 1`, kills tailwind, and falls through — the lifecycle listener then runs the full graceful chain (plugins → dispatch/watchdog/doctor → watcher → `search.shutdown()` which stops the antfly child → SSE → HTTP → audit → ledger → server lock) and owns the exit. The dev handler must NEVER call `process.exit` here: that preempts the chain and orphans antfly on its port (#459 defect 1).
- **Second signal (escape hatch):** a repeated SIGINT/SIGTERM while a graceful shutdown is hung logs a warning and force-exits (130 for SIGINT, 143 for SIGTERM).
- A `process.on('exit')` hook kills tailwind on every JS-level exit path regardless of who calls `process.exit`.

Known gap: a signal landing after antfly is spawned but before `registerShutdownHandlers()` (end of `server.ts` `main()`) exits via the dev path and can orphan antfly — accepted in the spec; the adapter-side sync exit hook on the antfly-zig branch (PR #457) covers it.

The tailwind child is spawned as the lockfile-pinned `node_modules/.bin/tailwindcss` directly under bun — the child pid IS the tailwind process, so `kill('SIGTERM')` reaches it. It was previously spawned via `bunx`, which inserted a wrapper chain (volta-shim → bunx → node) that ate the signal and orphaned the node `--watch` grandchild, and downloaded floating `@tailwindcss/cli@latest` instead of the pinned devDependency. Comment-only CSS edits may not rewrite the output file (identical result, mtime unchanged) — use an output-changing rule when verifying the watch pipeline.

## Imitation Crab

`bun run dev:mock` starts the OpenClaw-compatible mock under
`dev/imitation-crab/`. The mock is still a development harness, not a production
runtime adapter: Bakin talks to it through the OpenClaw adapter by setting
`OPENCLAW_HOME` and `OPENCLAW_PATH`.

Runtime knobs:

- `IMITATION_CRAB_HOME` / `OPENCLAW_MOCK_HOME` — mock home directory. Default:
  `~/.imitationcrab`.
- `IMITATION_CRAB_PORT` / `OPENCLAW_MOCK_PORT` — mock gateway port. Default:
  `18789`.
- `OPENCLAW_MOCK_CHAT_MODE` — `canned`, `echo`, `error`, `slow` (reply after
  `OPENCLAW_MOCK_CHAT_DELAY_MS`, default 2000), `idle-timeout` (codex
  app-server idle-timeout error → typed turn death), or `session-death`
  (accepts the turn, writes an oversized-interrupted trajectory into the mock
  home, never sends a final frame — exercises fail-fast forensics + the
  recovery ladder end to end; see `.claude/knowledge/session-forensics.md`).
- `OPENCLAW_MOCK_TOOL_MODE` — `ok` or `error`.
- Per-message markers (stripped from the reply): `[[tool]]` (scripted tool-call
  frame sequence), `[[dropped-delta]]` (self-heal path), `[[slow]]` — a long
  reply streamed word-by-word for ~15s. `[[slow]]` is the chat-QUEUE showcase
  (#729): send it, then type + Enter to queue follow-ups mid-stream, × one to
  restore its text, or Stop mid-stream (partial text kept) and watch the
  queued messages drain as one combined turn. Per-message, unlike
  `OPENCLAW_MOCK_CHAT_MODE=slow` which parks BEFORE streaming and slows every
  turn globally.
- `OPENCLAW_MOCK_FORCE=1` — bypasses the safety check that refuses to run when
  a real OpenClaw binary/config/gateway is detected.

`bun run mock:seed --force` removes the configured mock home before copying
fixtures, so stale fixture files cannot survive a re-seed.

Tests that need the mock as a contract harness should use
`createImitationCrabHarness()` from `dev/imitation-crab/harness.ts`. It creates
an isolated mock home, seeds fixtures, installs the CLI shim, wires an OpenClaw
runtime adapter with mock settings, pairs it with `createMockSearchAdapter()`,
and intercepts fetches to the mock gateway in-process. Use
`startGateway: true` only for manual/server smoke tests where binding a local
port is part of what you need to verify.

`tests/dev/mock-runtime-contract.test.ts` is the baseline runtime contract suite
for the harness. `tests/dev/mock-runtime-failure-contract.test.ts` covers the
adapter-facing failure contract. `tests/dev/mock-onboarding-contract.test.ts`
proves seeded and intentionally corrupted fixtures through onboarding runtime
and credential checks. Add new runtime-surface expectations there when adapter-
backed features expand instead of creating one-off mock smoke tests.

## One-React-instance invariant

The shell and every plugin share React via the import map:

```
/vendor/react.js           ← single React instance, loaded once per page
/vendor/react-dom.js       ← single react-dom instance, uses /vendor/react.js
/vendor/sdk-*.js           ← @makinbakin/sdk bundles, externalize react
/vendor/sdk-shared-*.js    ← code-split chunks shared by the SDK bundles (relative imports, no map entries)
```

The dev watcher preserves this:

- **Shell rebuild** regenerates `packages/host/dist/main.js`. Does NOT touch `/vendor/`. React is the same instance across the reload.
- **Plugin rebuild** regenerates `plugins/<id>/dist/client.js`. Does NOT touch `/vendor/`. New module's `import React from 'react'` resolves via import map to the same `/vendor/react.js` the browser already loaded.
- **SDK rebuild** regenerates the `sdk-*.js` bundles in `/vendor/`. `react*` bundles aren't rebuilt — their inputs didn't change. Triggers a full reload so the new SDK bundles are picked up cleanly.
- **CSS swap** doesn't touch JS. Nothing React-related moves.

Any future change that rebuilds a vendor bundle keyed on React **must** trigger a full reload. A plugin or SDK change that naively re-imports a React-containing module would create a second React instance and break hooks globally. The dev watcher never does this; v3 Fast Refresh work would need to preserve the invariant.

## Hot-swap mechanism (v2)

When a core plugin client file changes:

1. `scripts/dev.ts` calls `buildOnePlugin(id, { serverEntry: false })` — client assets only; core server bundles aren't built at all (core server code is statically imported from source, #421). On success, captures `mtime` of the new `plugins/<id>/dist/client.js` and broadcasts `{ type: 'dev:hot-swap', scope: 'plugin', id, version: mtime }`.
2. Dev client debounces events per-plugin (100 ms), picks the latest, calls `window.__bakinHotSwapPlugin(id, '/api/plugins/<id>/assets/client.js', version)`.
3. `PluginHost` (in the shell bundle) runs:
   a. `unregisterPlugin(id)` from `@makinbakin/sdk`:
      - Runs enrolled cleanup fns (`cleanupByPlugin.get(id)`). Workflows plugin uses this to sweep its node-renderer and workflow-source registries.
      - Drops nav items keyed on `id`.
      - Calls `clearSlotsOwnedBy(id)` — sweeps slot entries where `entry.owner === id`. Unowned entries (test registrations, pre-v2 legacy) survive.
      - Bumps `registry.version` + notifies subscribers.
   b. Swaps the plugin's `<link data-bakin-plugin-css="<id>">` with a cache-busted href (if present). Old link removes on new link's `onload`.
   c. `await import(clientEntry + '?v=' + version)` — browser fetches the new bundle, new module instance runs `registerPlugin({...})` as a side effect, re-populating nav + slots. Registry version bumps again.
4. Registry consumers (`<Slot>` in `packages/sdk/src/slots/index.tsx`, `<AppSidebar>` in `packages/host/src/components/layout/app-sidebar.tsx`) subscribe to `subscribeRegistry` via `useSyncExternalStore`. Each bumped version triggers a re-render at every subscribed consumer independently. The subscription lives at the consumer, **not** at `PluginHost` — a parent's store re-render doesn't force descendants with unchanged props to re-execute, so any component that reads the registry at render time has to own its own subscription.

When a linked user plugin file changes:

1. `src/core/plugin-host/hot-reload-coordinator.ts` watches the
   lockfile's `linked: true` entries. `bakin dev` starts this coordinator
   automatically, and `bakin plugins link <path>` attaches a
   watcher immediately if the server is already running.
   `~/.bakin/plugins/<id>` is a symlink in this mode; startup plugin
   discovery must follow symlinks to directories, not rely on
   `Dirent.isDirectory()`.
2. On save, the coordinator rebuilds the linked source with
   `buildUserPlugin()`. Build failures emit `dev:error` and keep the
   watcher alive; the next save retries.
3. On successful build, `runReloadPipeline()` imports the new server
   module with a cache-busting query. Import failure leaves the old plugin
   active. Activation failure sweeps partial registrations and disables
   the plugin until the next successful save.
4. A successful server reload bumps the plugin version and broadcasts
   `dev:hot-swap` through both the main SSE bridge and the dev SSE
   channel. `PluginHost` refreshes `/api/plugins/manifest`, swaps CSS if
   needed, unregisters the old client contribution, and imports the new
   client bundle.

Most day-to-day UI and route changes should not require a restart. Rare
changes that alter durable schema, content-type ownership, or startup-only
contracts may still need a restart; document those cases in the plugin's
own development notes.

Linked plugin watching is root-watch plus manifest filtering. Chokidar v5
does not interpret glob strings passed directly to `watch()`, so the
coordinator watches the plugin source root, then filters events against
`devWatch` patterns itself. Supported patterns intentionally cover the
common plugin shapes: literal files/directories, `*`, `?`, and `**/*.ext`.

Plugin modules must not create lifetime side effects during import. Old
module instances remain reachable after cache-busted hot reloads, so
top-level timers, process listeners, file watchers, sockets, EventSources,
and event-target listeners leak across saves. The
`bakin/no-plugin-top-level-side-effects` ESLint rule enforces the direct
cases. Create lifetime resources inside `activate(ctx)` or narrower
handlers, store the handle/disposer, and clean them in `onShutdown()`.

### Why the old module doesn't break

- Old module's exports (React components) were rendered into the DOM. After `unregisterPlugin`, the shell re-renders without those components — React unmounts the subtrees. The exports become garbage.
- Browser's ES module cache keeps the old module object alive (keyed on the old URL). That's a small memory leak proportional to `(plugin size × edits)`. See "Safety valve" below.
- `registerPlugin` re-running with the same `id` is not an error — the registry `Map.set`s, which overwrites cleanly.
- One React instance is preserved: both the old and new module import `'react'`, which resolves via import map to the same `/vendor/react.js` loaded at page open.

## Safety valve (v2 memory bound)

Every hot-swap adds a cached ES module entry keyed on `?v=<hash>`. Browsers have no `import.cache.delete()` API, so old modules stay cached for the tab's lifetime.

Math: each hot-swap costs (plugin bytecode + React tree references it holds). For a 200 KB core plugin across 100 edits, ~20 MB of cached bytecode. Plus any closures the old module's functions still capture (should be zero if every registered API has a paired teardown).

The dev client counts hot-swaps in `sessionStorage['bakin-dev-hotswap-count']` and forces `location.reload()` every 100. Rationale for `sessionStorage`:
- **tab-scoped** (matches the lifetime of the module cache we're bounding)
- **persists across user-initiated reloads** (so the count doesn't reset to 0 when the user hits Cmd+R, which would allow the cache to grow unbounded)
- **not shared across tabs** (each tab has its own cache; no cross-contamination)

Acceptance criterion from the plan: heap growth < 100 MB after 100 swaps. If a plugin exceeds that cutoff, the registry cleanup is leaking (not passive caching) and needs to be fixed before shipping — don't just raise the cutoff.

## Isolation from the content watcher

Two chokidar instances, zero overlap:

- **Content watcher** (`src/core/watcher.ts`): roots at `getContentDir()` — an absolute path under `~/.bakin/`.
- **Dev watcher** (`scripts/dev.ts`): roots relative to `process.cwd()` — the repo tree (`packages/host/src`, `plugins/`, etc.).

Both instances have non-overlapping ignore filters (`node_modules`, `.git`, `dist`). A file save in `~/.bakin/` never triggers a rebuild; a file save in `packages/host/src/` never fires a content event.

## Registration APIs and their teardown paths

v2 hot-swap is correct iff every client-side registration API has a paired teardown. Current inventory:

| Registration API | Where | Owner key | Teardown |
|---|---|---|---|
| `registerPlugin({id, navItems, slots})` | `packages/sdk/src/register.ts` | `id` | `unregisterPlugin(id)` |
| `registerSlot(name, component, order, owner)` | `packages/sdk/src/slots/index.tsx` | `owner` (pluginId) | `clearSlotsOwnedBy(pluginId)` — called by `unregisterPlugin` |
| `registerNodeRenderer(kind, component)` | `plugins/workflows/lib/node-renderer-registry.ts` | `kind` | `unregisterNodeRenderer(kind)` — swept by `registerPluginCleanup('workflows', …)` |
| `registerPluginDefinition(pluginId, id, def)` | `packages/core/src/workflows/source-registry.ts` | `pluginId` | `unregisterPluginDefinitions(pluginId)` — same cleanup hook |

For linked user plugins, server-side registrations (`ctx.registerExecTool`,
`ctx.hooks.register`, `ctx.registerRoute`, `ctx.search.registerContentType`,
etc.) are swept and rebuilt by the server reload pipeline. For core plugins
in the repo, `scripts/dev.ts` still ignores root `index.ts`; changing core
plugin server registrations requires restarting `bakin dev`.

Server-side hot reload unregisters search content-type wiring and pending
reconciles for the plugin, then re-registers them on activate. It does not
drop the underlying search tables on every save; destructive table purging
belongs to plugin remove/uninstall.

## Gotchas that bit us during the initial rollout

These all surfaced during hands-on testing and are the most likely places a well-intentioned refactor re-introduces a bug.

### Asset Cache-Control in dev = `no-store`

Both `_static.ts` (shell, vendor, globals.css, favicon) and `api/plugins/assets.ts` (plugin client bundles) set `Cache-Control: no-store` when `BAKIN_DEV=1`; the prod path keeps `public, max-age=300`. Without this, `location.reload()` refetches `index.html` (which is already `no-cache`) but the browser's HTTP cache serves the stale `main.js` / `client.js` from its cache for up to 5 minutes, and the visible change never appears. User symptom is "page flickered like it reloaded, but my edit didn't show up."

The helper is `cacheControlFor(urlOrPath, status)` — exported for testing. Unit tests in `tests/api/host-static.test.ts` lock the policy in.

### Tailwind CLI v4: `--watch=always`, not bare `--watch`

We spawn the Tailwind CLI with `stdio: ['ignore', 'inherit', 'inherit']`, which closes the child's stdin immediately. Tailwind's v4 CLI exits its watch loop silently when stdin closes — which looks indistinguishable from "watching but no source changes." The fix is the documented `--watch=always` flag that keeps the loop alive across stdin-close. Without it, the CSS path goes dark after the first build and CSS edits never produce output.

### Shell watcher excludes `.css` deliberately

The shell watcher's extension regex is `/\.(ts|tsx)$/`, not `/\.(ts|tsx|css)$/`. Including `.css` would trigger a full shell rebuild (and a `dev:reload` page reload) on every CSS edit, racing ahead of and winning against the link-swap path. CSS edits go exclusively through Tailwind's `--watch=always` child → output file mtime change → CSS watcher → `dev:css` → link swap, with no page reload and all JS state preserved.

### `/__bakin-dev/*` 404s in production, not SPA-fallback 200

In `_static.ts`, the `/__bakin-dev/*` path check runs **unconditionally** and returns 404 when `BAKIN_DEV !== '1'`. If it fell through to the SPA fallback, `GET /__bakin-dev/client.js` in production would return `index.html` with a 200 status — benign (no dev-client bytes leak) but semantically wrong. Tests in `tests/api/dev-routes.test.ts` + binary-launch acceptance at the end of the rollout verify all dev routes 404 cleanly in the compiled binary.

### Duplicate same-version hot-swap events are no-ops

Linked plugin saves can produce both a main SSE plugin reload and a dev SSE
hot-swap for the same plugin/version. The dev client usually collapses this,
but `PluginHost` must also dedupe exact `clientEntry?v=version` imports and
serialize swaps per plugin. Without that guard, a second same-version swap
can call `unregisterPlugin(id)`, import a browser-cached module whose
module-load side effects do not re-run, and leave the plugin missing from
the nav until a manual browser refresh.

### `scripts/dev-build-one-plugin.ts` uses `node:child_process.spawn`, not `Bun.spawn`

Bun implements `node:child_process.spawn` API-compatibly; the helper uses it rather than `Bun.spawn` for a portable interface that doesn't depend on the Bun-global surface. Matches the pattern in `packages/host/src/plugin-host/user-plugin-builder.ts`.

## Adding a new scope to the dev watcher

To wire a new source tree into the watch/rebuild/broadcast cycle:

1. Add a new `startXxxWatcher()` in `scripts/dev.ts` — follow the pattern of `startShellWatcher()`: chokidar on the directory, extension/path filter in the handler, schedule via `scheduleRebuild`.
2. Add a new scope string to the `DevScope` union in `packages/host/src/api/dev/events.ts`.
3. Add a handler arm to the dev client's `switch (event.type)`.
4. Broadcast `dev:building` on start and either `dev:reload` / `dev:hot-swap` on success or `dev:error` on failure. Use `emitSuccess()` / `emitError()` to get dev:recover emission on success-after-error.
5. Update the matrix in `CONTRIBUTING.md` and this doc.

## Adding a new registration API to `@makinbakin/sdk`

If a plugin needs a new client-side registry beyond nav + slots, the teardown contract is:

1. Expose the registry as a module with `register` + `unregister` (or `clear`) primitives. Key entries by whatever makes sense for the registry — for plugin-owned entries, include a `pluginId` tag.
2. In the plugin's `client.tsx`, after the `registerPlugin` call:
   ```ts
   import { registerPluginCleanup } from '@makinbakin/sdk'

   registerPluginCleanup('my-plugin', () => {
     // Sweep whatever you registered
     myRegistry.clearOwnedBy('my-plugin')
   })
   ```
3. Test the teardown: after `unregisterPlugin('my-plugin')`, the new registry has no entries for that id. Re-registration works.

If you skip step 2, hot-swap leaks memory every edit. The 100-swap safety-valve reload hides it, but the passive-caching math from above will rot sooner than that. Don't.

## Plugin module-load contract

Plugin `client.tsx` files must do only two things at module load:

1. Sanctioned SDK API calls: `registerPlugin(...)`, `registerSlot(...)`, `registerPluginCleanup(...)`, and plugin-local registry registrations (workflows' `registerNodeRenderer` / `registerPluginDefinition` — both of which are swept via `registerPluginCleanup`).
2. Imports of components + types.

**Do not** at module load:

- `window.addEventListener(...)` — the listener survives hot-swap; memory leak + double-fire
- `document.body.*` or `document.head.*` mutations — same
- `setInterval` / `setTimeout` at top level — same
- `fetch(...)` — fires every hot-swap; can be racy
- `globalThis.*` writes outside the SDK registries — bypasses the teardown path

Audit command for finding violations across every core plugin:

```sh
for f in plugins/*/client.tsx; do
  echo "=== $f ==="
  grep -E "addEventListener|setInterval|setTimeout|document\.|window\.|fetch\(|globalThis\." "$f" || echo "  (clean)"
done
```

All 10 core plugins were audited clean as of commit 8 of the HMR rollout.

## Troubleshooting

**Save didn't trigger a rebuild.**
Check `/tmp/bakin-dev.log` (or wherever you're capturing stdout) for `[dev]` lines. Silent = chokidar didn't see the event. Possible causes:
- File is outside every watcher's root (e.g., `src/core/**` is intentionally not watched).
- Plugin source is outside the plugin's `devWatch` globs. Check `bakin-plugin.json` and the defaults in `src/core/plugin-host/hot-reload-coordinator.ts`.
- `node_modules`/`.git`/`dist` — ignored on purpose.

**Browser didn't reload after a rebuild succeeded.**
Open DevTools → Network. Confirm the EventSource on `/api/dev/events` is open (persistent connection, `text/event-stream`). If it's closed, the EventSource auto-reconnects but there's a ~2 s gap where events are lost. The dev client logs reconnect warnings to the console.

**Hot-swap fallback to reload.**
If `window.__bakinHotSwapPlugin` is missing at swap time, the dev client logs a warning and falls back to `location.reload()`. Causes:
- `BAKIN_DEV` wasn't set at server boot (check `process.env.BAKIN_DEV` in the dev log).
- Shell didn't mount or didn't reach the `useEffect` that sets the window handle.
- Production build (compiled binary) — handle is undefined by design.

**Overlay stays after fixing the error.**
The overlay clears on a `dev:recover` event, which fires on the first successful rebuild after a failed one (per-scope tracking in `scripts/dev.ts`). If the overlay persists:
- Check which scope errored vs. which scope succeeded — they need to match for recover to fire. Fix a plugin error by editing that plugin, not by editing the shell.
- Click the overlay to dismiss manually; it's purely cosmetic at that point.

**Memory growing across many hot-swaps.**
Expected up to ~100 MB over 100 swaps of the same plugin — safety-valve reload fires and resets. If you hit the cutoff faster, something in the plugin's registration isn't being torn down. Add a test in `tests/sdk/register.test.ts` that exercises the teardown and confirms no residual state.
