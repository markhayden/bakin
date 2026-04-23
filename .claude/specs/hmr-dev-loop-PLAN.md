# HMR Dev Loop — Implementation Plan

> **Status:** Draft — awaiting review
> **Spec:** `.claude/specs/hmr-dev-loop.md`
> **Scope:** v1 (live-reload) + v2 (plugin hot-swap), single PR, 9 commits

## Summary

Implements `bun run dev` as a watch-mode entry point. Commits 1–5 deliver v1 (per-scope rebuilds, SSE reload channel, CSS link-swap, error overlay). Commits 6–8 deliver v2 (per-plugin hot-swap with registry teardown). Commit 9 is documentation. No new dependencies. Production build path, the compiled binary, `bun run start`, and `bun run server` are not touched.

Two design details worth surfacing before any commit lands:

- **The slot registry (`packages/sdk/src/slots/index.tsx`) does not track which plugin owns each entry.** Assets plugin registers `asset-preview`; any plugin can register a competing renderer with lower `order`. v2's per-plugin cleanup requires ownership tracking — added in commit 6 as part of the unregister API. This is a real design gap v2 has to close, not just a wiring task.
- **Only the workflows plugin has plugin-local client registries** beyond the SDK's nav + slots: `node-renderer-registry` (keyed by node `kind`) and `source-registry` (keyed by workflow `id` with `pluginId` tagged on each entry). Both already expose individual unregister primitives. v2 adds a `registerPluginCleanup(id, fn)` SDK API so workflows can hook its two registries into the unified teardown — and any future plugin that grows its own registry can too.

## Preconditions

Before commit 1:

- Working tree clean on `main` (currently at `d08ebc7`).
- `bunx vitest run` passes — establishes a green baseline to compare against.
- `bun run build` succeeds end-to-end (vendors + plugins + host-shell + binary compile).
- The old npm-linked `/opt/homebrew/bin/bakin` shadow has been removed (separate work, already discussed).

Create a feature branch:

```
git checkout -b hmr-dev-loop
```

Each commit below targets this branch.

## Design pre-commitments (decide once, reference from the commits)

### Dev-client compilation path

- **Source:** `packages/host/src/dev-client/client.ts` (plain TS, no TSX, no React imports).
- **Build target:** at `bun run dev` startup, `scripts/dev.ts` runs an in-process `Bun.build()` with:
  ```ts
  await Bun.build({
    entrypoints: ['./packages/host/src/dev-client/client.ts'],
    outdir: './packages/host/public/__bakin-dev/',
    target: 'browser',
    format: 'esm',
    sourcemap: 'inline',
    minify: false,
  })
  ```
- **Output:** `packages/host/public/__bakin-dev/client.js` — disk-only, not checked in, `.gitignore`d.
- **Not embedded.** `scripts/generate-embedded-assets.ts` already globs under `packages/host/public/`; we add `__bakin-dev/` to its exclusion list so compiled binaries never ship the dev client.
- **Rebuilt once per `bun run dev` invocation.** The dev client itself isn't watched — changes to it require Ctrl-C + restart. Keeps the watcher graph acyclic.

### Plugin `devWatch` manifest field

- Added to `packages/core/src/plugin-types.ts`'s `BakinPluginManifest` type (verify existing name during commit).
- Zod schema extension (in `packages/host/src/plugin-host/user-plugin-builder.ts` or wherever manifest validation lives — confirm during commit):
  ```ts
  devWatch: z.array(z.string()).optional()
  ```
- **Default when absent** (applied by `scripts/dev.ts`, not the schema):
  ```ts
  ['client.tsx', 'components/**', 'lib/**', '*.ts']
  ```
  Globs are evaluated relative to the plugin root. `index.ts` is always excluded (server-entry, takes the restart path).
- **Warning text on invalid glob** (e.g., path escapes plugin root):
  ```
  [bakin-dev] plugin <id>: invalid devWatch entry <glob> — falling back to default
  ```
  Logged once per `bun run dev` boot via `console.warn`. Does not abort startup.

### Safety-valve reload counter

- Counter lives in `sessionStorage` under key `bakin-dev-hotswap-count`. Key choice:
  - `localStorage` persists across tabs/sessions → over-counts.
  - Module-scope state resets on manual reloads, leading to exactly-100 loops in edge cases.
  - `sessionStorage` is scoped to the tab lifetime — which matches the "module cache we're trying to bound" lifetime exactly.
- Reset to 0 on any `location.reload()` (the module re-runs on load and re-reads the counter). After a non-hot-swap reload (e.g., the user hit Cmd+R), the counter stays at the pre-reload value — intentional, since the module cache also persists across user-initiated reloads.
- Correction to the above: `sessionStorage` IS cleared on manual reload of the tab? No — sessionStorage persists within a tab across reloads, clears on tab close. That's the behavior we want.
- Threshold: 100 hot-swaps since last session start. Dev client reads it at start, increments on each hot-swap, forces `location.reload()` when count >= 100, resets to 0 after the reload.

### HTML-injection test location

- **New file:** `tests/api/host-static.test.ts` (there is no existing test for `packages/host/src/api/_static.ts`).
- Follows the `tests/api/` flat convention already in use (`tests/api/` holds other HTTP-handler tests like `plugins-install.test.ts`).
- Mocks `process.env.BAKIN_DEV` per-test; uses `tmpdir`-based fixture for the `public/index.html` source file, per the content-dir mocking convention from `CLAUDE.md`.

### Commit sequence — invariants

- `bunx vitest run` passes at the end of every commit.
- `bun run build` succeeds at the end of every commit.
- `bun run start` works (app loads, all 10 plugins mount) at the end of every commit.
- `bun run dev` is introduced at commit 4 and progressively improves through commit 8.

If any commit breaks one of these, fix forward — don't revert.

## Per-commit task breakdown

### Commit 1 — `chore(dev): extract buildOne(id) from build-plugins.ts`

**Prework:**
- Read the current `scripts/build-plugins.ts` end to end.
- Note the `CORE_PLUGINS` array and the `EXTERNAL` constant.

**Tasks:**
1. Create `scripts/dev-build-one-plugin.ts` exporting:
   ```ts
   export async function buildOnePlugin(id: string): Promise<{ ok: true } | { ok: false; stderr: string }>
   ```
   - Contains the server + client build logic currently inside the for-loop in `scripts/build-plugins.ts` (subprocess invocations, unchanged args).
   - Imports `CORE_PLUGINS` and `EXTERNAL` from — **wait**, the for-loop builds *any* plugin id given to it; it doesn't check membership. The helper takes any id; the caller is responsible for passing a valid one. Keep `CORE_PLUGINS` and `EXTERNAL` in `scripts/build-plugins.ts`, move only the build logic.
   - Accepts a second optional `{ pluginsDir = 'plugins' }` param so `scripts/dev.ts` can point it at user plugins later (future-proof; no usage in this commit).
   - Returns `{ ok: false, stderr }` on subprocess failure instead of `process.exit(1)`.
2. Rewrite `scripts/build-plugins.ts` to import `buildOnePlugin` and loop over `CORE_PLUGINS`, calling it once per id. Preserve existing exit-on-error behavior in the batch builder.
3. No functional change visible to `bun run build:plugins`.

**Files touched:**
- New: `scripts/dev-build-one-plugin.ts`
- Modified: `scripts/build-plugins.ts`

**Acceptance check:**
```
bun run build:plugins
# → identical output to before (10 plugins built)
ls plugins/tasks/dist plugins/workflows/dist
# → {index.js, client.js} in each
bunx vitest run tests/api/plugins-build.test.ts
# → passes
```

### Commit 2 — `feat(dev): add BAKIN_DEV-gated /api/dev/{events,notify} routes`

**Prework:**
- Confirm `src/core/sse.ts` shape (already read) — the dev SSE client set does not piggyback on the production one.

**Tasks:**
1. Create `packages/host/src/api/dev/events.ts`:
   - Exports `get(req: Request, url: URL): Promise<Response>` in the Web-Fetch handler shape used by other migrated routes.
   - Checks `process.env.BAKIN_DEV === '1'` first; returns `new Response('Not found', { status: 404 })` otherwise.
   - Owns a module-local `Set<ReadableStreamDefaultController>`. Each new client is added; a `req.signal` 'abort' listener removes it.
   - Exports a `broadcastDev(event: DevEvent): void` function used by `/api/dev/notify`.
   - `DevEvent` type defined in this file (spec's event shape).
2. Create `packages/host/src/api/dev/notify.ts`:
   - Exports `post(req: Request, url: URL): Promise<Response>`.
   - Checks `BAKIN_DEV` gate (404 otherwise).
   - Parses JSON body as `DevEvent` via a zod schema (reject invalid shapes with 400).
   - Calls `broadcastDev(event)`; returns `{ ok: true }`.
3. Wire both into `server.ts`:
   - Import at the top of the API-route imports block.
   - Dispatch at the top of the request handler, right after the MCP / SSE blocks:
     ```ts
     if (process.env.BAKIN_DEV === '1') {
       if (url.pathname === '/api/dev/events' && req.method === 'GET') {
         handleSseAsNodeReqRes(req, res, devEventsRoute.get); return
       }
       if (url.pathname === '/api/dev/notify' && req.method === 'POST') {
         dispatchWebHandler(req, res, devNotifyRoute.post); return
       }
     }
     ```
   - SSE through the adapter needs attention — check `dispatchWebHandler` in `packages/host/src/api/_adapter.ts` for how to stream a SSE Response through the Node `http` response. If the adapter doesn't already support streaming, route `/api/dev/events` through a parallel Node-native path similar to `handleSSE` in `src/core/sse.ts`, but owned by the dev module. (Expect this to be the gnarliest task in commit 2.)
4. Make sure `broadcastDev` is importable from other modules — needed by commit 4's watcher.

**Files touched:**
- New: `packages/host/src/api/dev/events.ts`
- New: `packages/host/src/api/dev/notify.ts`
- Modified: `server.ts`

**Acceptance check:**
```
# Without BAKIN_DEV set
bun run start &
curl -i http://localhost:3737/api/dev/events
# → HTTP/1.1 404
curl -i -X POST -H 'content-type: application/json' -d '{"type":"dev:ready"}' http://localhost:3737/api/dev/notify
# → HTTP/1.1 404

# With BAKIN_DEV=1
BAKIN_DEV=1 bun run server.ts &
curl -i http://localhost:3737/api/dev/events
# → HTTP/1.1 200, Content-Type: text/event-stream (leave it open; it's SSE)

# In another shell while the EventSource is connected:
curl -X POST -H 'content-type: application/json' \
  -d '{"type":"dev:ready"}' http://localhost:3737/api/dev/notify
# → {"ok":true}, and the first shell receives the event in its stream.
```

### Commit 3 — `feat(dev): inject dev-client script into index.html when BAKIN_DEV=1`

**Prework:**
- Reread `packages/host/src/api/_static.ts`.
- Note that the SPA fallback path serves `index.html` for anything not `/assets/*`, `/vendor/*`, `/globals.css`, `/favicon.ico`.

**Tasks:**
1. In `_static.ts`, extract a new helper:
   ```ts
   async function loadIndexHtml(): Promise<Buffer | null>
   ```
   - Tries embedded path first, disk fallback second.
   - Returns raw bytes.
2. Add `transformIndexHtmlForDev(bytes: Buffer): Buffer`:
   - If `process.env.BAKIN_DEV !== '1'`, returns `bytes` unchanged (byte-identical reference).
   - Else: searches for `</body>` (UTF-8, case-insensitive) and inserts:
     ```html
     <script type="module" src="/__bakin-dev/client.js"></script>
     ```
     immediately before it. Concatenates and returns. If `</body>` is not found, logs a warning and returns bytes unchanged (don't break the response).
3. Serve `/__bakin-dev/client.js` from disk when `BAKIN_DEV=1`:
   - In the request handler branch for static paths, add an early-return for `url.pathname.startsWith('/__bakin-dev/')` that resolves to `packages/host/public/__bakin-dev/<rest>`.
   - Returns 404 when the file isn't there (dev client hasn't been built yet).
4. Update `scripts/generate-embedded-assets.ts` to exclude `__bakin-dev/` from the embedded set. (Verify its globbing code; add the exclusion where other exclusions already live.)
5. Add `packages/host/public/__bakin-dev/` to `.gitignore`.

**Files touched:**
- Modified: `packages/host/src/api/_static.ts`
- Modified: `scripts/generate-embedded-assets.ts`
- Modified: `.gitignore`

**Acceptance check:**
```
# New test (written in this commit)
bunx vitest run tests/api/host-static.test.ts
# → two passing cases: BAKIN_DEV=1 injects, unset leaves bytes unchanged

# Manual
BAKIN_DEV=1 bun run server.ts &
curl http://localhost:3737/ | grep __bakin-dev
# → <script type="module" src="/__bakin-dev/client.js"></script>
#   (the script 404s on fetch, which is fine until commit 4)

bun run start &
curl http://localhost:3737/ | grep __bakin-dev
# → (no match)
```

### Commit 4 — `feat(dev): scripts/dev.ts watcher coordinator (v1 skeleton)`

**Prework:**
- Decide on the signal mechanism from watcher → dev SSE: in-process function call (watcher imports `broadcastDev`) or HTTP POST to `/api/dev/notify`. **Pick: direct import.** `scripts/dev.ts` spawns `server.ts` as a child process (so the server can be Ctrl-C'd and re-spawned), and communicates via HTTP — the watcher needs a way into the server's in-memory state. HTTP POST to `/api/dev/notify` is the lowest-friction path. Use `fetch('http://localhost:3737/api/dev/notify', ...)`.
- Actually — reconsider. If the watcher is in-process *inside* `server.ts` instead of a sibling, no HTTP round-trip needed and no child process management. **Revised pick:** `scripts/dev.ts` is a wrapper that (a) runs the initial build, (b) compiles the dev-client, (c) sets `BAKIN_DEV=1`, (d) imports and runs `server.ts` — the watcher starts inside the server's own process, sharing memory with the dev routes. Simpler, faster, no IPC.

**Tasks:**
1. Create `scripts/dev.ts`:
   ```ts
   // Set BAKIN_DEV before any imports that read it
   process.env.BAKIN_DEV = '1'

   // 1. Run initial prestart build (reuse existing scripts)
   await $`bun run build:css && bun run build:vendors && bun run build:plugins && bun run build:host-shell`
   // (Skip build:assets-manifest — disk fallback in _static.ts covers dev)

   // 2. Build the dev client (see "Design pre-commitments")
   await Bun.build({ ... })

   // 3. Start watchers (commit 4 adds a minimal skeleton; commit 5 fleshes it out)
   startWatchers()

   // 4. Run the server (imports server.ts directly — shares process + memory)
   await import('../server.ts')
   ```
2. Create `startWatchers()` in `scripts/dev.ts` that wires chokidar:
   - Shell watcher: `packages/host/src/**/*.{ts,tsx,css}` excluding `dev-client/**`. On debounced change → run shell rebuild (spawn `bun run packages/host/build.ts` subprocess) → on success POST `{type:'dev:reload', scope:'shell'}`, on failure POST `{type:'dev:error', scope:'shell', ...}`.
   - Plugin watchers: one chokidar per plugin, globs resolved from each plugin's `bakin-plugin.json` `devWatch` field (default if absent). On change → `buildOnePlugin(id)` from commit 1 → broadcast.
   - SDK watcher: `packages/sdk/src/**`. On change → spawn `bun run scripts/build-vendors.ts` → broadcast.
   - Tailwind child process: spawn `bunx @tailwindcss/cli --watch -i ./packages/host/src/globals.css -o ./packages/host/public/globals.css`. Attach a chokidar watcher on the output path; on mtime change → broadcast `{type:'dev:css'}`.
   - Debounce: 50 ms per watcher (per Design pre-commitments).
   - Scope-queue: if a rebuild is in-flight for the same scope, set a "pending" flag; when current rebuild ends, fire once more. Never queue > 1.
3. Update `package.json`:
   ```json
   "dev": "bun run scripts/dev.ts",
   ```
   Delete the old value.
4. The dev client at `packages/host/src/dev-client/client.ts` is a stub in this commit — it just opens an EventSource on `/api/dev/events` and `console.log`s every event. Actual reload behavior lands in commit 5.

**Files touched:**
- New: `scripts/dev.ts`
- New: `packages/host/src/dev-client/client.ts` (stub)
- Modified: `package.json` (`"dev"` script rewritten)

**Acceptance check:**
```
bun run dev
# → prints initial-build output, then "Bakin ready on http://localhost:3737"
# → Tailwind watcher running as a child

# In a browser, visit http://localhost:3737, open DevTools → Console.
# Save any file in packages/host/src/. Within ~2s:
# → terminal shows "rebuilding shell..." and "shell rebuild ok"
# → console shows: {type:'dev:building',scope:'shell'}  then {type:'dev:reload',scope:'shell'}
# (Browser doesn't reload yet — stub client only logs.)

# Save plugins/tasks/components/board.tsx. Within ~2s:
# → terminal shows "rebuilding plugin tasks..."
# → console shows: {type:'dev:reload',scope:'plugin'}

# Touch ~/.bakin/projects/test.md:
# → content watcher fires in the activity feed (if visible); NO plugin rebuild.

# Save a file in packages/host/src/ AND touch ~/.bakin/projects/test.md simultaneously:
# → Shell rebuilds, projects watcher fires — independently, no interference.
```

### Commit 5 — `feat(dev): CSS link-swap + error overlay (v1 complete)`

**Prework:**
- Confirm `<link rel="stylesheet" href="/globals.css">` is the only stylesheet tag to swap.

**Tasks:**
1. Flesh out `packages/host/src/dev-client/client.ts` to handle every `DevEvent`:
   - `dev:ready`: log "connected".
   - `dev:building`: optional — could render a subtle top-bar indicator. v1 scope: skip, no UI. (If we do render, remove on next terminal event.)
   - `dev:css`: find the `<link rel="stylesheet" href="/globals.css">` tag, clone with `href` + `?v=${Date.now()}` cache-buster, append to `<head>`. When the new link's `onload` fires, remove the old one. Atomic swap, no flicker.
   - `dev:reload`: `location.reload()`.
   - `dev:hot-swap`: in v1 ignored-and-fallback — log "hot-swap not yet implemented, reloading" and call `location.reload()`.
   - `dev:error`: render a fixed-position red overlay:
     ```
     position: fixed; top: 0; left: 0; right: 0;
     background: #7c1d1d; color: #fff;
     font: 13px/1.4 ui-monospace, monospace;
     padding: 12px 16px; white-space: pre;
     overflow-y: auto; max-height: 50vh;
     z-index: 2147483647;
     cursor: pointer;  // click to dismiss
     ```
     Content: `<scope> build failed\n\n<message>\n\n<stderr>` (stderr truncated to 4 KB to avoid pathological cases).
   - `dev:recover`: remove the overlay if present.
2. Error handling inside `scripts/dev.ts` rebuild wrappers: capture subprocess stderr, POST `{type:'dev:error', scope, message:'build failed', stderr}`. On success after a prior error, POST `{type:'dev:recover', scope}` before the normal reload event.
3. Add a basic top-bar ribbon (visually minimal) that appears during `dev:building`. Thin 2px high bar across the top in accent color. Remove on reload/recover/css/hot-swap events. Nice-to-have; skip if time pressed (it's DX polish).

**Files touched:**
- Modified: `packages/host/src/dev-client/client.ts`
- Modified: `scripts/dev.ts` (wrap rebuild subprocess calls with stderr capture)

**Acceptance check:**

Run `bun run dev`, then:
- **Shell edit test:** Change a visible string in `packages/host/src/components/layout/app-header.tsx` (verify exact path — it may be `header.tsx` or similar) and save. Within 2 s, browser reloads with the new string.
- **Plugin edit test:** Change a label in `plugins/tasks/components/kanban-board.tsx`. Save. Browser reloads within 2 s; new label visible. `mtime` of `plugins/tasks/dist/client.js` is newer than all other plugin dist client.js files (confirm via `ls -lt plugins/*/dist/client.js`).
- **CSS edit test:** Type text in an input on the app, then edit `packages/host/src/globals.css` to change `--accent` color. Save. Within 1 s, the accent color changes. Input text survives — no reload happened.
- **SDK edit test:** Add a comment to `packages/sdk/src/hooks/use-query-state.ts`. Save. Browser reloads within 3 s. `ls -l packages/host/public/vendor/react.js` mtime unchanged.
- **Error test:** Add a syntax error to `packages/host/src/main.tsx` (e.g., unclosed brace). Save. Red overlay appears within 2 s, app below remains interactive. Fix the error. Overlay clears; page reloads.
- **Server-entry edit test:** Edit `plugins/tasks/index.ts`. Save. Overlay shows "Server restart required" (wait — commit 4's watcher scope excludes `index.ts`; this case is out of v1 scope. Skip this check in v1; it's a v4 follow-up.). **Revision:** confirm that editing a plugin's `index.ts` does NOT cause a misleading client rebuild/reload. Silent is correct here (the server-side bundle won't reload anyway).
- **Production untouched:**
  ```
  bun run start &
  curl -i http://localhost:3737/api/dev/events  # → 404
  ```
- `bunx vitest run` — all tests pass.

**At the end of commit 5, v1 is complete and usable.** If the user wants to pause here and evaluate before taking on v2, this is the natural checkpoint.

### Commit 6 — `feat(sdk): add unregisterPlugin + getRegistryVersion APIs`

**Prework:**
- Reread `packages/sdk/src/register.ts` and `packages/sdk/src/slots/index.tsx`.
- Note: slot registry has NO ownership tracking. This commit closes that gap.

**Tasks:**
1. In `packages/sdk/src/slots/index.tsx`, extend `SlotEntry` with an `owner` field:
   ```ts
   interface SlotEntry {
     component: ComponentType<Record<string, unknown>>
     order: number
     owner?: string   // pluginId, undefined for unowned/test registrations
   }
   ```
   Extend `registerSlot` with an optional `owner` param (default `undefined`). Don't require callers to pass it — existing call sites (tests, `__clearSlot`) compile unchanged.
2. In `packages/sdk/src/register.ts`:
   - Update the `registerSlot` call inside `registerPlugin` to pass `reg.id` as the owner:
     ```ts
     registerSlot(slotName, component, 100, reg.id)
     ```
     (Confirms the signature change in step 1 is used at the single API entry point.)
   - Add a monotonic version counter on the `ClientRegistry`:
     ```ts
     interface ClientRegistry {
       navByPlugin: Map<string, NavItem[]>
       version: number
       listeners: Set<() => void>
       cleanupByPlugin: Map<string, Array<() => void>>
     }
     ```
   - Export `getRegistryVersion(): number` and `subscribeRegistry(listener: () => void): () => void`. Used by PluginHost in commit 7.
   - Export `registerPluginCleanup(id: string, fn: () => void): void`. Plugins with their own registries (workflows) call it during their `registerPlugin` flow to enroll teardown steps.
   - Replace the existing `__clearPluginRegistration` implementation with a public `unregisterPlugin(id: string): void`:
     ```ts
     export function unregisterPlugin(id: string): void {
       const registry = getRegistry()
       // 1. Run plugin-supplied cleanup functions (workflows uses this)
       const cleanups = registry.cleanupByPlugin.get(id) ?? []
       for (const fn of cleanups) { try { fn() } catch (e) { console.error(e) } }
       registry.cleanupByPlugin.delete(id)
       // 2. Drop nav items
       registry.navByPlugin.delete(id)
       // 3. Drop slot entries owned by this plugin
       clearSlotsOwnedBy(id)   // new helper in slots/index.tsx
       // 4. Bump version, notify subscribers
       registry.version++
       for (const l of registry.listeners) l()
     }
     ```
   - Delete `__clearPluginRegistration`. It was private (underscore-prefixed, "intended for tests + hot-reload"). Tests that used it now use `unregisterPlugin`.
3. In `packages/sdk/src/slots/index.tsx`, add:
   ```ts
   export function clearSlotsOwnedBy(pluginId: string): void {
     const reg = getRegistry()
     for (const [name, entries] of reg.entries()) {
       const filtered = entries.filter((e) => e.owner !== pluginId)
       if (filtered.length === 0) reg.delete(name)
       else reg.set(name, filtered)
     }
   }
   ```
   Delete `__clearSlot` — it's superseded by the owner-aware clear. Update any tests that used it.
4. Export the new APIs from `packages/sdk/src/index.ts`:
   - `registerPlugin`, `unregisterPlugin`, `getAllNavItems`, `getPluginNavItems`, `registerPluginCleanup`, `getRegistryVersion`, `subscribeRegistry`, `type NavItem`, `type PluginRegistration` (and `Slot`/`registerSlot` from slots).
5. In `plugins/workflows/client.tsx`, wire cleanup:
   ```ts
   import { registerPluginCleanup } from '@bakin/sdk'
   import {
     unregisterNodeRenderer, listNodeRendererKinds,
   } from './lib/node-renderer-registry'
   import {
     getStore as getWorkflowSources,   // may need to export this from source-registry
   } from './lib/source-registry'

   registerPluginCleanup('workflows', () => {
     // Node renderers: clear every kind the workflows plugin owns.
     // Built-in kinds (trigger, agent, gate, ...) are owned by workflows.
     // Namespaced kinds like `{otherPlugin}.foo` are not — the owning plugin cleans those up.
     // Today only workflows registers into this registry, so it's safe to clear ALL.
     for (const kind of listNodeRendererKinds()) unregisterNodeRenderer(kind)

     // Workflow source definitions owned by this plugin id.
     // (Requires a small helper added to source-registry.ts: removeByPlugin('workflows').)
   })
   ```
   This is workflow plugin scope — implement the two small teardown helpers in the workflows plugin lib files, don't push them into the SDK.
6. Update existing SDK tests (`tests/sdk/slots.test.tsx` and any test that uses `__clearSlot` / `__clearPluginRegistration`) to use the new public API. Expected to be a find-and-replace of a handful of call sites.

**Files touched:**
- Modified: `packages/sdk/src/register.ts` (significant rewrite)
- Modified: `packages/sdk/src/slots/index.tsx` (owner field, `clearSlotsOwnedBy`)
- Modified: `packages/sdk/src/index.ts` (exports)
- Modified: `plugins/workflows/client.tsx` (cleanup wiring)
- Modified: `plugins/workflows/lib/node-renderer-registry.ts` (if `listNodeRendererKinds` not exported — it is, confirmed from source)
- Modified: `plugins/workflows/lib/source-registry.ts` (add `removeByPlugin(pluginId)` helper)
- Modified: `tests/sdk/slots.test.tsx` (migration off removed `__clear*` helpers)

**Acceptance check:**
```
bunx vitest run tests/sdk tests/plugins
# → all pass

# New unit tests added in this commit:
bunx vitest run tests/sdk/register.test.ts   # new — covers unregisterPlugin
```

Tests for `unregisterPlugin`:
1. Register plugin 'x' with nav items + slots. `unregisterPlugin('x')` → `getAllNavItems()` drops x's entries; `getSlotEntries(slotName)` drops x's entries. Re-registering afterward works.
2. Plugin A and plugin B both register into the same slot with different owners. `unregisterPlugin('A')` → only A's entry removed; B's stays.
3. Registered cleanup fn for plugin 'x' runs when 'x' is unregistered. Idempotent: calling `unregisterPlugin('x')` twice only runs cleanup once.
4. `getRegistryVersion()` increments on every `registerPlugin` and `unregisterPlugin` call.

### Commit 7 — `feat(dev): PluginHost subscribes to registry version, exposes hotSwapPlugin`

**Prework:**
- Reread `packages/host/src/plugin-host/PluginHost.tsx`.
- Confirm: the shell is wrapped by `<PluginHost>` in `packages/host/src/providers/` or `packages/host/src/main.tsx` (confirm during commit).

**Tasks:**
1. In `PluginHost.tsx`:
   - Subscribe to `getRegistryVersion()` via `useSyncExternalStore`. Every version bump triggers a re-render.
   - Export an imperative handle:
     ```ts
     export async function hotSwapPlugin(
       id: string,
       clientEntry: string,
       version: string,
     ): Promise<void>
     ```
     - Calls `unregisterPlugin(id)` from the SDK.
     - Dynamic-imports `${clientEntry}?v=${version}` (cache-buster).
     - Returns when the new module has executed (i.e., its side-effect `registerPlugin` has run).
     - Throws on import failure; caller (dev client) decides to fall back to reload.
   - Expose `hotSwapPlugin` on `window.__bakinHotSwapPlugin` when `BAKIN_DEV=1` (the dev client can't directly import from the shell bundle easily; the window handle is the pragmatic bridge for dev-only code).
2. The plugin manifest already gained a `version` field in commit 3 — **wait no, it didn't.** Re-read the spec carefully — the spec says "Added in v1 so the field exists when v2 starts using it." Place it in THIS commit instead, since it's a v2 requirement and nothing in commits 1–5 actually reads it. Cleaner. Update `packages/host/src/api/plugins/manifest.ts` now:
   - Add `version: string` per plugin (source of truth: the plugin's `bakin-plugin.json` `version` field — already exists, already required).
   - Rename/alias to avoid collision if needed. Confirm during commit.
3. Subscribe side effect: when `getRegistryVersion()` bumps AND no hot-swap is mid-flight, nav items + slots re-render naturally because PluginHost reads them at render time.

**Files touched:**
- Modified: `packages/host/src/plugin-host/PluginHost.tsx`
- Modified: `packages/host/src/api/plugins/manifest.ts` (add `version` field to response)

**Acceptance check:**
```
bun run dev
# Visit app, everything loads as before (no behavior change yet).

# Open DevTools console:
typeof window.__bakinHotSwapPlugin
# → "function"

# Manually trigger hot-swap:
await window.__bakinHotSwapPlugin('tasks', '/api/plugins/tasks/assets/client.js', 'test-v1')
# → nav + slots refresh; sidebar briefly "Tasks" disappears and reappears; no reload
```

### Commit 8 — `feat(dev): plugin hot-swap path in dev-client (v2 complete)`

**Prework:**
- Read the final dev client from commit 5.
- Confirm the dev SSE `dev:hot-swap` event shape from commit 2.

**Tasks:**
1. In `packages/host/src/dev-client/client.ts`:
   - Replace the v1 `dev:hot-swap` fallback (currently `location.reload()`) with:
     ```ts
     const swapFn = (window as any).__bakinHotSwapPlugin
     if (typeof swapFn !== 'function') {
       location.reload()   // belt-and-suspenders; PluginHost didn't wire the handle
       return
     }
     try {
       await swapFn(ev.id, `/api/plugins/${ev.id}/assets/client.js`, ev.version)
     } catch (err) {
       console.error('[bakin-dev] hot-swap failed, falling back to reload:', err)
       location.reload()
     }
     ```
   - Implement the safety-valve reload counter per "Design pre-commitments":
     ```ts
     const COUNTER_KEY = 'bakin-dev-hotswap-count'
     const count = Number(sessionStorage.getItem(COUNTER_KEY) ?? '0') + 1
     sessionStorage.setItem(COUNTER_KEY, String(count))
     if (count >= 100) {
       sessionStorage.setItem(COUNTER_KEY, '0')
       location.reload()   // periodic cache reset
     }
     ```
   - Debounce: if multiple `dev:hot-swap` events for the same plugin id arrive within 100 ms, coalesce to the latest.
2. In `scripts/dev.ts`:
   - For plugin watchers, change the broadcast from `{type:'dev:reload', scope:'plugin'}` to `{type:'dev:hot-swap', scope:'plugin', id, version}` where `version` is the mtime of the newly-written `plugins/<id>/dist/client.js` as a string. (v1 clients would `location.reload()` on this event; v2 clients do the hot-swap.)
3. Complete the plugin module-load side-effect audit per the checklist below. For each of the 10 core plugins, confirm `client.tsx` does no module-load side effect outside the sanctioned APIs. Any finding gets fixed in this commit as part of v2 readiness — it's not a follow-up.

**Files touched:**
- Modified: `packages/host/src/dev-client/client.ts`
- Modified: `scripts/dev.ts`
- Possibly modified: individual plugin `client.tsx` files if the audit finds side effects

**Acceptance check:**

Run `bun run dev`, then per the spec's v2 acceptance criteria:
1. **Plugin hot-swap.** Open tasks view, scroll, open a task detail dialog. Edit `plugins/tasks/components/kanban-board.tsx`. Save. Within 1.5 s, tasks subtree re-renders; sidebar scroll + SSE activity feed + URL all preserved. Verify no page reload via console `performance.timing.navigationStart`.
2. **Cross-plugin isolation.** Navigate tasks → workflows → tasks. Edit tasks component. Only `/api/plugins/tasks/assets/client.js?v=<hash>` is refetched (Network tab).
3. **Hot-swap fallback.** Introduce `throw new Error('x')` at top of `plugins/tasks/client.tsx`. Save. Dev client logs the error and falls back to `location.reload()`. Overlay shows the next error.
4. **Memory bound.** 100 saves to `plugins/tasks/components/kanban-board.tsx` in a row. Heap Snapshot after vs. baseline: < 100 MB growth. At the 100th swap, the safety-valve reload fires. Counter resets, next 100 repeats.
5. `bunx vitest run` — all pass.
6. `bun run build && ./dist/bakin-darwin-arm64 start` — binary launches, `/api/dev/events` returns 404.

**At the end of commit 8, v2 is complete.**

### Commit 9 — `docs: dev-loop coverage`

**Tasks:**

1. **`README.md`** — add to the Getting Started / Development section:
   ```markdown
   ### Development

   bun run dev    # watch mode with hot-swap (daily iteration)
   bun run start  # one-shot build + serve (production preview)
   bun run build  # produce distributable binary
   ```
   Two-sentence description of what `bun run dev` does.

2. **`CONTRIBUTING.md`** — rewrite the "Development loop" section:
   - `bun run dev` is the default daily iteration command.
   - Shell / plugin / CSS / SDK edits hot-reload or hot-swap automatically.
   - Server-side code (`src/core/**`, `server.ts`, plugin `index.ts`) still requires Ctrl-C + `bun run dev` again.
   - Plugin authors can override watch globs via `bakin-plugin.json#devWatch`.

3. **`CLAUDE.md`** — under Architecture add:
   > **Dev mode:** `bun run dev` starts a watcher + dev SSE channel at `/api/dev/events`. When `BAKIN_DEV=1`, `_static.ts` injects a dev-client script into served `index.html`. See `.claude/knowledge/dev-loop.md`.

   Revise the existing "Runtime Data Directory" command surface note so `dev` ≠ `start` is clear.

4. **`.claude/knowledge/dev-loop.md`** (new) — deep reference:
   - Architecture diagram (copy from the spec with slight polish).
   - The one-React-instance invariant and how each tier preserves it.
   - How v2 hot-swap works (registry teardown + cache-busted re-import).
   - The registration APIs that need paired teardown (nav, slots, workflows node renderers, workflows source definitions) — and the `registerPluginCleanup` hook for future plugin-local registries.
   - Plugin module-load contract: no raw `window.addEventListener`, no direct-to-DOM side effects — only calls through `registerPlugin`, `registerSlot`, `registerPluginCleanup` and plugin-local registries that have matching teardown.
   - Safety valve: 100-swap periodic reload.
   - How to add a new scope to the dev watcher.
   - Explicit non-goals: React Fast Refresh (v3), server-side reload (v4), LAN/Tailscale dev (v5).

5. **`docs/plugin-authoring.md`** — add "Dev-mode contract" section:
   - `devWatch` field in `bakin-plugin.json` (default + override).
   - If your plugin uses plugin-local registries, wire cleanup via `registerPluginCleanup(id, fn)` in `client.tsx`.
   - Don't do module-load side effects (window listeners, mutation of document, etc.) — they leak across hot-swaps.
   - Example snippet.

**Files touched:**
- Modified: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `docs/plugin-authoring.md`
- New: `.claude/knowledge/dev-loop.md`

**Acceptance check:**
- All modified docs render correctly on GitHub (spot-check Markdown).
- `bunx vitest run` — all pass.
- `bun run typecheck` — clean.
- `bun run lint` — clean.

## Pre-v2 audit checklists

### Plugin client-module-load side-effect audit (completed during commit 8)

One checkbox per plugin. Reviewer reads each `client.tsx` end to end and confirms it only calls into the sanctioned APIs: `registerPlugin`, `registerSlot`, `registerPluginCleanup`, and plugin-local registries (workflows only).

The audit looks for:
- `window.addEventListener(...)` at module top level
- `document.addEventListener(...)` at module top level
- `document.body.*` or `document.head.*` mutation at module load
- Top-level `setInterval` / `setTimeout`
- Network requests (`fetch(...)`) at module load
- Direct mutation of `globalThis.*` outside the registered registries
- Event emitter subscriptions that aren't cleaned up

| # | Plugin | `client.tsx` LoC | Must audit | Findings |
|---|---|---:|---|---|
| 1 | assets | 38 | ✅ | _fill in during commit 8_ |
| 2 | health | 18 | ✅ | |
| 3 | memory | 18 | ✅ | |
| 4 | messaging | 31 | ✅ | |
| 5 | models | 18 | ✅ | |
| 6 | projects | 24 | ✅ | |
| 7 | schedule | 18 | ✅ | |
| 8 | tasks | 19 | ✅ | |
| 9 | team | 20 | ✅ | |
| 10 | workflows | 49 | ✅ | |

Expected outcome: based on reading tasks/assets/workflows already (commits 1 preparatory reading), 9 of 10 are trivial. Workflows is the interesting one and its `registerNodeRenderer` + source-registry calls are already wired for hot-reload.

### Registration-API teardown inventory (completed during commit 6)

Every client-side registration API that v2 hot-swap must tear down. Server-side registrations (`ctx.registerExecTool`, `ctx.hooks.register`, etc.) are out of scope — those persist until server restart.

| # | Registration API | File | Keyed by | Teardown |
|---|---|---|---|---|
| 1 | `registerPlugin({ id, navItems, slots })` | `packages/sdk/src/register.ts` | plugin id | `unregisterPlugin(id)` — new in commit 6 |
| 2 | `registerSlot(name, component, order, owner)` | `packages/sdk/src/slots/index.tsx` | slot name + owner | `clearSlotsOwnedBy(pluginId)` — new in commit 6, called by `unregisterPlugin` |
| 3 | `registerNodeRenderer(kind, component)` | `plugins/workflows/lib/node-renderer-registry.ts` | kind | `unregisterNodeRenderer(kind)` — already exists; swept by workflows' `registerPluginCleanup` fn |
| 4 | `registerPluginDefinition(pluginId, id, definition)` | `plugins/workflows/lib/source-registry.ts` | plugin id + def id | `removeByPlugin(pluginId)` — new helper in commit 6 |

If any future plugin adds a 5th client-side registry, the author wires it through `registerPluginCleanup` from the SDK — no SDK changes needed.

## Risk → commit mapping

| Risk (from spec) | Mitigation commit |
|---|---|
| **v2 risk 1.** Registry cleanup incomplete → memory leak. | Commit 6 — audit inventory above is completed; every registration API has a paired teardown. |
| **v2 risk 2.** Imperative hot-swap handle escapes dev. | Commit 7 — `window.__bakinHotSwapPlugin` is only set when `BAKIN_DEV=1`. Commit 8 dev-client reads it via `(window as any)` which won't be reached in production code paths (dev-client not in the binary). |
| **v2 risk 3.** In-plugin component state doesn't survive. | Documented in commit 9 (`docs/plugin-authoring.md`). Not a mitigation — by design. |
| **v2 risk 4.** Hot-swap event race. | Commit 8 — 100 ms debounce coalesces per-plugin events. |
| **v2 risk 5.** Plugin module-load side effects leak across swaps. | Commit 8 — audit every `client.tsx`; document contract in commit 9. |
| **v1 risk — `_static.ts` HTML transform corrupts prod bytes.** | Commit 3 — env-gated transform + unit test for byte-equal when unset. |
| **v1 risk — dev SSE route ships in binary.** | Commit 2 — route registration env-gated; handlers also env-check. Commit 8's binary-launch acceptance step verifies 404. |
| **v1 risk — chokidar roots overlap content watcher.** | Commit 4 — dev chokidar roots are repo-relative; content watcher is `getContentDir()` (absolute `~/.bakin/`). No overlap possible. |
| **v1 risk — chokidar descends into node_modules.** | Commit 4 — every chokidar instance sets `ignored: [/node_modules/, /\.git/, /dist/]`. |

## Test impact

### New tests (added during the commits that introduce them)

| File | Commit | What it covers |
|---|---|---|
| `tests/api/host-static.test.ts` | 3 | HTML transform: `BAKIN_DEV=1` injects, unset preserves byte-identical |
| `tests/sdk/register.test.ts` | 6 | `unregisterPlugin` (new) — per-plugin nav + slot cleanup, cross-plugin isolation, cleanup fn execution, `getRegistryVersion` bumping |

### Existing tests likely affected

Before commit 6, scan for usages that will break:

```
grep -rn "__clearPluginRegistration\|__clearSlot" tests packages plugins
```

Expected hits (plan assumption — verify during commit 6):
- `tests/sdk/slots.test.tsx` — uses `__clearSlot` for cleanup between test cases. Migrate to `unregisterPlugin('test-plugin')` or a fresh setup.
- Possibly plugin tests that call `__clearPluginRegistration` in `beforeEach`. Migrate.

If a test writes to the registries directly (bypassing `registerPlugin`), it may not have an `owner` on its slot entries — that's fine; owner is optional and unowned entries don't get swept by `unregisterPlugin`.

### Existing tests that must continue passing across every commit

- `tests/api/plugins-build.test.ts` (commit 1 refactor risk)
- `tests/api/plugins-install.test.ts` (manifest shape changes at commit 7 if we add a `version` field — verify parser tolerates / requires it as planned)
- `tests/sdk/slots.test.tsx` (commit 6 touches slot registry)
- `tests/plugins/workflows/*` (commit 6 adds cleanup wiring in `workflows/client.tsx`)
- `tests/components/**` (commit 7 touches PluginHost — existing tests for render paths should still pass)

## Post-merge verification

Run after merge to main, sequentially:

```
# 1. Dev-mode smoke (v1 path)
git pull origin main
bun install
bun run dev
# visit http://localhost:3737, confirm app loads
# edit packages/host/src/components/layout/app-header.tsx, save
# → browser reloads within 2 s with your edit visible
# Ctrl-C

# 2. Dev-mode smoke (v2 path)
bun run dev
# visit app, navigate to tasks, scroll, open a task detail dialog
# edit plugins/tasks/components/kanban-board.tsx (change a label), save
# → within 1.5 s, tasks view re-renders; sidebar scroll preserved, no page reload
# Ctrl-C

# 3. Production preview (no dev mode)
bun run start
# visit app, confirm all 10 plugins load
# curl -i http://localhost:3737/api/dev/events  → 404
# Ctrl-C

# 4. Binary build + launch
bun run build
./dist/bakin-darwin-arm64 start
# visit app, confirm all 10 plugins load
# curl -i http://localhost:3737/api/dev/events  → 404
# confirm no __bakin-dev/ script tag in curl http://localhost:3737/
# Ctrl-C

# 5. Full test suite
bunx vitest run
# → every test green

# 6. Typecheck + lint
bun run typecheck
bun run lint
# → clean
```

If any step fails, the revert plan is:
- Step 1 or 2 fails → revert commits 4–9, keep 1–3 (scaffolds don't run without commit 4's watcher).
- Step 3 or 4 fails → the env gating leaked. Revert commit 3 first, re-test.
- Step 5 fails → identify the regressing test, inspect which commit touched that file.

## Documentation checklist

Summarizing what commit 9 must touch, for final review:

- [ ] `README.md` — Getting Started: add `bun run dev` line + brief description.
- [ ] `CONTRIBUTING.md` — rewrite Development loop section.
- [ ] `CLAUDE.md` — Architecture paragraph on dev mode; update command-surface note.
- [ ] `.claude/knowledge/dev-loop.md` — **new** deep reference.
- [ ] `docs/plugin-authoring.md` — new "Dev-mode contract" section with `devWatch`, `registerPluginCleanup`, module-load contract, example.
- [ ] `.gitignore` — `packages/host/public/__bakin-dev/` (added in commit 3, verify).

Spec reference (`.claude/specs/hmr-dev-loop.md`) does not need edits — the plan is stacked on top of it.

## Open items for reviewer (blocking the move to `/agent-skills:build`)

- **Approval of the commit 6 API shape.** The `registerPluginCleanup(id, fn)` + `getRegistryVersion` + `subscribeRegistry` additions to `@bakin/sdk` become part of the plugin author API. If you want different names, now is the time.
- **Approval of the safety-valve counter in `sessionStorage`.** Alternatives: localStorage (too sticky), module-scope (resets on manual reload), none (unbounded). `sessionStorage` is my pick.
- **Approval of the `version` field on the manifest response landing in commit 7 instead of commit 3.** Spec says commit 3 (for future-proofing); plan moves it to commit 7 (where it's actually used). Cleaner but deviates from the spec order slightly. Call it.
- **Confirmation that SDK tests moving off `__clearSlot` / `__clearPluginRegistration` is OK as a commit-6 migration.** Alternative: keep deprecated shims that delegate to the new APIs. Per standing "no backwards-compat shims" guidance, the migration is cleaner.
