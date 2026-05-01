# PLAN — OpenAPI from typed route contracts

Source: `SPEC.md`. Branch: `feat/route-contracts` cut from `main`.

## 1. Surface area (verified)

- **In-repo plugins (8)** — migrated in this PR: `tasks`, `workflows`, `schedule`, `assets`, `memory`, `team`, `models`, `health`. Route counts: tasks 12, workflows 18, schedule 10, assets 11, memory 16 (split across `lib/routes/*.ts`), team 29 (largest), models 11, health 7. Total ~114 plugin routes.
- **Extracted plugins** — `messaging`, `projects` exist in this repo only as `plugins/{messaging,projects}/dist/` build artifacts. Source lives in `../bakin-bits-official/plugins/`. Source not edited in this PR. `extractApiRoutes` scans the sibling repo and emits fallback schemas marked `x-bakin-source: "extracted"`. Validator exempts them until a sibling-repo follow-up.
- **Core routes** — ~50 hand-listed in `src/core/api-docs.ts` `CORE_ROUTES`, plus the file-routed handlers under `packages/host/src/api/**/*.ts`. Migrated in T14–T16, organized by subject.
- **Server entry** — `server.ts` at repo root (not `packages/host/src/server.ts`).
- **Plugin route registration site** — `src/lib/plugin-registry.ts` (not `packages/core/src/plugin-host.ts`). This is where `ctx.registerRoute` is implemented today; the migration adapter goes here.
- **Test infrastructure** — `tests/core/`, `tests/plugins/`, `tests/api/`, `tests/architecture/` exist. New foundation tests slot into `tests/core/` and a new `tests/docs/`.

## 2. Dependency graph

```
                   ┌────────────────────────────┐
                   │ Foundation                 │
                   │  T1: types + helpers       │
                   │  T2: registry              │
                   │  T3: Zod→OpenAPI converter │
                   │  T4: dispatcher + adapter  │
                   │  T5: validator + /api/docs │
                   └────────────┬───────────────┘
                                │
        ┌──────────────────┬────┴────┬───────────────┬───────────┐
        ▼                  ▼         ▼               ▼           ▼
   T6:tasks           T7:workflows T8:schedule  T9:assets   T10:memory
        │                  │         │               │           │
        ▼                  ▼         ▼               ▼           ▼
  T11:team           T12:models  T13:health
        └──────────────────┴─────────┘
                                │
                                ▼
                   ┌────────────────────────────┐
                   │ Core route migration       │
                   │  T14: agents/*             │
                   │  T15: dispatch/settings/   │
                   │       agent-packages/pkgs  │
                   │  T16: plugins + misc       │
                   └────────────┬───────────────┘
                                │
                                ▼
                   ┌────────────────────────────┐
                   │ T17: cleanup (delete       │
                   │      legacy paths,         │
                   │      retain extracted-     │
                   │      plugin scan)          │
                   └────────────┬───────────────┘
                                │
                                ▼
                   ┌────────────────────────────┐
                   │ T18: fail-closed flip      │
                   │      regenerate openapi    │
                   └────────────────────────────┘
```

Plugin migrations (T6–T13) are independent. Execution order: `tasks` first (user priority), then size order. Each plugin migration is a complete vertical slice.

T3 (converter) is split out from T4 (dispatcher) so the largest commit doesn't bundle four concerns. Each is independently revertable.

## 3. Vertical slicing

Every task delivers a runnable, testable, demoable end-to-end change. No horizontal "all schemas first, then all handlers" layering.

- T1–T5: foundation. Each adds working machinery + a test demonstrating it.
- T6–T13: each plugin. Schemas, handler refactor, tests, OpenAPI snapshot delta, validator warning count delta.
- T14–T16: each core slice.
- T17: cleanup. Verifiable by absence (deletes + scoped grep).
- T18: enforcement. Verifiable by validator behavior + clean OpenAPI snapshot.

## 4. Tasks

For each task: **Goal**, **Touched files**, **Acceptance criteria**, **Verification**, **Rollback significance**.

Every task ends with the same gate: `bun run build && bun run typecheck && bun test --isolate && bun run docs:check`. Warnings allowed in T1–T17. T18 flips the validator to fail-closed.

---

### T1 — Types, helpers, plugin shape

**Goal.** Introduce the new type hierarchy and authoring helpers without touching any plugin or dispatcher behavior.

**Touched files.**
- New: `packages/core/src/routing/types.ts` — `RouteContext`, `APIRoute<C, P, Q, B>`, `ParsedInput<P, Q, B>`, `ResponseSpec` discriminated union (`JsonResponseSpec`, `NoContentResponseSpec`, `NonJsonResponseSpec`).
- New: `packages/core/src/routing/define.ts` — `defineRoute`, `defineCoreRoute`, `definePlugin` const-generic identity functions.
- Modified: `packages/core/src/plugin-types.ts` — add `routes?: APIRoute[]` (optional during migration) to `BakinPlugin`. `PluginContext.registerRoute` retained for now.
- Modified: `packages/core/src/docs/metadata.ts` and `packages/sdk/src/metadata/index.ts` — consolidate duplicated `RouteContract` (SDK re-exports core).
- Modified: `packages/sdk/src/index.ts` — re-export `definePlugin`, `defineRoute`, `searchRoute`.

**Acceptance.** Helpers compile; `BakinPlugin.routes` exists; existing plugin behavior unchanged.

**Verification.** `tests/core/routing-types.test.ts` with type-level inference assertions. Full gate.

**Rollback.** Self-contained additions.

---

### T2 — Route registry + duplicate detection + path matching

**Goal.** Single `RouteRegistry` that owns the canonical method+path table.

**Touched files.**
- New: `packages/core/src/routing/registry.ts` — `RouteRegistry` with `register(route, scope)`, `match(method, url)`, `clear()`, `all()`.
- New: `packages/core/src/routing/operation-id.ts` — `operationIdFor(scope, method, path)` slug helper.

**Acceptance.** Radix match with literal-beats-param precedence; duplicate `<method, fullPath>` throws; duplicate operationId throws; `clear()` resets; plugin routes prefixed `/api/plugins/<id>`.

**Verification.** `tests/core/route-registry.test.ts`. Full gate.

**Rollback.** Pure additive module.

---

### T3 — Zod→OpenAPI converter + shared error envelope

**Goal.** Build the schema-conversion layer in isolation. No dispatcher changes yet.

**Touched files.**
- New: `packages/core/src/openapi/zod-to-openapi.ts` — wraps `z.toJSONSchema` for parameters, request bodies, response bodies. Converts `:id` paths to `{id}`. Helpers for global `400`/`415` emission.
- New: `packages/core/src/openapi/errors.ts` — `errorEnvelope` Zod schema + `400`/`415` builders.
- New: `packages/core/src/openapi/operation.ts` — single-route OpenAPI Operation builder consuming `APIRoute<...>`.

**Acceptance.** Given a `defineRoute({ params, query, body, responses })` literal, the converter emits a valid OpenAPI 3.1 Operation with correct `parameters`, `requestBody`, `responses`. Path `:id` segments emit as `{id}` with `parameters[in: 'path']`. Error envelope global `400`/`415` emit only when applicable (`415` only when `body` is declared).

**Verification.** `tests/docs/zod-to-openapi.test.ts`: golden-snapshot a small set of routes covering JSON shorthand, multipart, none-body, SSE response, mixed status responses. Full gate.

**Rollback.** Standalone module; revert deletes the file.

---

### T4 — Registry-driven dispatcher + legacy `ctx.registerRoute` adapter

**Goal.** Wire the registry into the request path. Auto-validate inputs. Adapt the legacy registration call so existing plugins keep working.

**Touched files.**
- New: `packages/core/src/routing/dispatcher.ts` — `dispatchRoute(req, url, registry, ctxFactory)`: extract path params, parse query, parse body per content type, call handler, validate response in dev/test.
- Modified: `server.ts` (repo root) — funnel `/api/*` through the dispatcher with the routing precedence rule from SPEC §Registry & dispatch:
  1. Registry match for any registered route (plugin or core).
  2. Legacy file-routed fallback under `packages/host/src/api/**` for unmigrated core routes (deleted in T17).
  3. Static asset / SPA shell fallback.
- Modified: `src/lib/plugin-registry.ts` — `ctx.registerRoute` now adapts the legacy `APIRoute` shape and writes into the registry. Adapter mapping: `input → body` (assumed `application/json`), `output → responses[200]`. Routes without schemas register as-is and surface in the validator (T5) as warnings.
- Modified: `packages/host/src/api/_adapter.ts` `dispatchWebHandler` — kept for now; called only from step 2 of the precedence above.

**Acceptance.** Every existing route still serves traffic. Routes registered through the new declarative shape work. Invalid body → `400 { error, issues }`. Wrong content type → `415`. `responses[status]` mismatch in dev → console warning; in test → throw. `/api/dispatch` (no body declared, no migrate yet) still works through the adapter.

**Verification.**
- `tests/core/route-dispatcher.test.ts` — 400/415/404/happy-path/none-body/dev-warn/test-fail.
- `tests/core/route-dispatcher-adapter.test.ts` — legacy shape flows through adapter.
- Smoke: `bun run dev:mock` then `curl http://localhost:3737/api/version`, `/api/agents`, `/api/plugins/tasks/`. All 200.
- Full gate.

**Rollback.** Largest commit. Revert restores file-routed dispatch path.

---

### T5 — Validator (warn mode) + `/api/docs` from registry

**Goal.** Surface every public route's schema status as warnings; serve a live OpenAPI doc from the registry.

**Touched files.**
- New: `scripts/docs/route-contract-check.ts` — walks the in-repo bundled surface (core + 8 in-repo plugins; excludes extracted `messaging`/`projects`). Emits warnings/errors per the validator rules in SPEC §Validator.
- Modified: `scripts/docs/check.ts` — invokes the new validator; mode flag controls warn-vs-fail.
- New: `packages/host/src/api/docs-runtime.ts` — `/api/docs` handler builds OpenAPI from the runtime registry once at boot, caches, invalidates on `dev:plugin:reload` SSE events.
- Modified: `src/core/api-docs.ts` — `/api/docs` route delegates to the new builder. Full deletion of `CORE_ROUTES` etc. happens in T17.

**Acceptance.** `bun run docs:check` lists every public bundled route missing schemas; exit 0 (warnings only). Output is greppable. `/api/docs` returns OpenAPI 3.1 JSON; hot-reload rebuild works under `bun run dev`. `messaging`/`projects` are emitted to the static OpenAPI but skipped by the validator.

**Note on `/api/docs` self-reference.** The `/api/docs` route is itself a registry-backed route. To avoid recursion: the OpenAPI document is built once from the registry **including** the `/api/docs` entry. Its own response schema is a passthrough OpenAPI document type (`{ contentType: 'application/json', schema: openApiDocumentSchema }`). The handler reads from the cache, never from a re-build.

**Verification.**
- `tests/docs/route-contract-check.test.ts`: missing schemas detected; internal/extracted ignored; multipart-without-schema accepted; `:id` path without `params` schema fails (when not migration-window-exempt).
- `tests/api/api-docs-runtime.test.ts`: `/api/docs` returns valid OpenAPI; rebuild on registry change.
- Manual: `bun run docs:check 2>&1 | head -40`.
- Full gate.

**Rollback.** Read-only diagnostics; clean revert.

---

### CHECKPOINT — Foundation complete

After T1–T5: every route still works, every dev request flows through the registry-backed dispatcher, validator surfaces all unmigrated routes as warnings, `/api/docs` is live. **Stop and verify.** If anything regresses, fix before T6.

Manual smoke checks:
- `bun run dev` → http://localhost:3737, exercise tasks UI, settings, agents start/stop.
- `curl http://localhost:3737/api/docs | jq '.paths | keys | length'`.
- `bun run docs:check 2>&1 | grep -c "missing"` — record warning baseline.

---

### T6 — Migrate `tasks` plugin

**Goal.** First plugin to declarative form. Establishes the migration pattern.

**Touched files.**
- `plugins/tasks/index.ts` — convert export to `definePlugin({ ... routes: [defineRoute(...)] })`. Module-scope Zod schemas (`createTaskBody`, `createTaskResponse`, `moveTaskBody`, etc.). Drop manual 400-validation in handlers.
- `plugins/tasks/bakin-plugin.json` — leave `contributes.apiRoutes` for now (T17 deletes it project-wide).
- `tests/plugins/tasks/*.test.ts` — drive routes via dispatcher; remove redundant manual-400 cases; assert registry presence.

**Acceptance.** All 12 routes have `body` (where applicable), `responses[200]`, `params` (where path has `:id`). `bun run docs:check` warning count drops by 12. `docs/public/openapi.json` for tasks paths contains specific JSON Schema. Tasks UI works under `bun run dev:mock`.

**Verification.** Full gate. Diff openapi.json.

**Rollback.** Single-plugin revert.

---

### T7 — `workflows` (18 routes)
### T8 — `schedule` (10 routes)
### T9 — `assets` (11 routes; multipart upload route declares `body: { contentType: 'multipart/form-data' }`)
### T10 — `memory` (16 routes; split across `lib/routes/*.ts` — each file exports `defineRoute(...)` entries; `index.ts` aggregates)
### T11 — `team` (29 routes — largest; budget 1.5×; reuse schemas via `plugins/team/types.ts`)
### T12 — `models` (11 routes)
### T13 — `health` (7 routes)

Each follows T6's shape: schemas → convert → tests → smoke → gate → commit.

---

### CHECKPOINT — All in-repo plugins migrated

After T13: 8 plugins on declarative routes. Validator warnings reduced to core only. Extracted plugin warnings persist (exempt). Expected remaining count ≈ unmigrated core routes (~50).

Manual smoke:
- `bun run dev` → exercise each plugin's primary UI (tasks board, workflow start, schedule cron list, asset upload, memory dashboard, team settings, models picker, doctor).
- Diff `docs/public/openapi.json`.

---

### T14 — Migrate `core/agents/*` routes

**Goal.** Move handler bodies from `packages/host/src/api/agents/*.ts` into `packages/host/src/core-routes/agents.ts`. Express each route as `defineCoreRoute(...)`.

**Touched files.**
- New: `packages/host/src/core-routes/index.ts` — barrel exporting `coreRoutes: APIRoute<CoreContext>[]`.
- New: `packages/host/src/core-routes/agents.ts` — exports `agentRoutes` array.
- Modified: `server.ts` — register `coreRoutes` into the registry before any plugins activate (boot order: core → in-repo plugins → user plugins).
- Legacy `packages/host/src/api/agents/*.ts` files remain for now; deleted in T17.

**Acceptance.** Routes covered: `/api/agents`, `/api/agents/avatar`, `/api/agents/health`, `/api/agents/settings` (GET, PUT), `/api/agents/start`, `/api/agents/stop`, `/api/agents/restart`, `/api/agents/:id`, `/api/agents/:id/status`, `/api/agents/:id/message`, `/api/agents/:id/tasks`. All have schemas. Warning count drops by 11. `bun run dev:mock` agent-control UI works.

**Verification.** Full gate. Smoke: agents start/stop/restart from UI.

---

### T15 — Migrate core/dispatch + settings + agent-packages + packages

**Touched files.** `packages/host/src/core-routes/{dispatch,settings,agent-packages,packages}.ts`. Extend `server.ts` register block.

**Routes (~16).** `/api/dispatch` (GET, POST), `/api/settings` (GET, POST), `/api/agent-packages*` (5), `/api/packages*` (4), `/api/plugin-settings/*` (3), `/api/curated`.

Same shape as T14.

---

### T16 — Migrate core/plugins + misc

**Touched files.** `packages/host/src/core-routes/{plugins,events,misc}.ts`.

**Routes (~22).** `/api/plugins/{install,link,unlink,upgrade,remove,manifest,assets/*}` (~7), plus `/api/version`, `/api/paths`, `/api/state`, `/api/search`, `/api/reindex`, `/api/activity*` (2), `/api/internal/continuation`, `/api/exec-tools/:toolName`, `/api/memory/log`, `/api/assets/:path`, `/api/docs`, `/api/events`, `/api/dev/events`, `/api/dev/notify`.

**Notes.**
- SSE: `/api/events`, `/api/dev/events` declare `responses[200]: { contentType: 'text/event-stream' }`. Validator passes them as non-JSON.
- Binary: `/api/agents/avatar`, `/api/assets/:path`, `/api/plugins/:pluginId/assets/:path` declare `responses[200]: { contentType: 'application/octet-stream' }` (or appropriate image type).
- `/api/dev/*` declare `visibility: 'internal'`.
- `/api/docs`: handler reads from the cached OpenAPI document built at boot. The route declares `responses[200]: { contentType: 'application/json', schema: openApiDocumentSchema }` where the schema is a permissive OpenAPI 3.1 document shape (no recursion into the live document).

**Acceptance.** Every public route has schemas. Warning count for in-repo + core surface drops to 0. Only `messaging`/`projects` remain (exempt).

**Verification.** Full gate. Smoke: SSE connection (`curl -N http://localhost:3737/api/events`), file fetch (`curl http://localhost:3737/api/agents/avatar?id=basil -o /tmp/avatar`), dev server reload, `/api/docs` returns valid OpenAPI without recursion.

---

### CHECKPOINT — Every in-repo route is declarative

After T16: registry covers every route the host owns. Legacy `ctx.registerRoute` has zero in-repo callers (only the extracted-plugin source-scan path remains). Validator warnings → 0 for in-repo + core.

---

### T17 — Cleanup

**Goal.** Delete the now-unused legacy paths.

**Touched files.**
- Delete: `src/core/api-docs.ts` `CORE_ROUTES`, `coreRoute()`, `routeDocs[]`, `registerRouteDoc()`, `getAllRoutes()`, `generateDocs(contentDir)`, `RouteDoc` type if unused.
- Delete: `dispatchWebHandler` in `packages/host/src/api/_adapter.ts`. Verify no callers (should be none after T16).
- Delete: file-routed core handlers under `packages/host/src/api/**/*.ts` whose subjects moved to `core-routes/`. Verify `packages/host/src/api/` collapses to `_adapter.ts`, `_static.ts`, `_embedded-assets*.ts` only (the static-asset path stays).
- Delete: `ctx.registerRoute` from `PluginContext` and the adapter wiring in `src/lib/plugin-registry.ts`.
- Delete: `contributes.apiRoutes` field from in-repo `bakin-plugin.json` files (the 8 migrated plugins).
- Modified: `scripts/docs/source-scan.ts` — delete `getApiRoutes()` (manifest-first/source-fallback wrapper). **Keep** `extractApiRoutes()` but scope its call site in `generate.ts` to extracted plugins (`messaging`, `projects`) only.
- Modified: `scripts/docs/generate.ts` — remove `schemaFromParamsHint`, `defaultRequestBody`, `schemaForParamHint`, fallback emission, legacy `routeOperation` overload reading from `RouteDoc`. Static OpenAPI: import in-repo plugin modules → read `plugin.routes` and `coreRoutes` → emit. Extracted plugins: emit from `extractApiRoutes()` against `../bakin-bits-official/`, marked `x-bakin-source: "extracted"` and `x-bakin-validator-exempt: true`.
- Updated: knowledge files per SPEC §9.

**Acceptance.**
- Scoped grep against production source only — `grep -rln "ctx.registerRoute" plugins/ packages/ src/ server.ts` → zero hits.
- `grep -rln "dispatchWebHandler" plugins/ packages/ src/ server.ts` → zero.
- `grep -rln "CORE_ROUTES" packages/ src/ scripts/` → zero.
- Docs/specs/tests *may* still mention the old API for historical reference; that is acceptable. Knowledge files (`.claude/knowledge/`) are updated to describe the new API.
- `contributes.apiRoutes` only in `plugins/{messaging,projects}/dist/...` (build artifacts; ignore) and possibly the sibling repo. In-repo source `bakin-plugin.json` files no longer carry the field.
- `bun run docs:check` warning count for in-repo + core: 0. Extracted-plugin warnings: still present, exempt.

**Verification.**
- Full gate.
- `tests/docs/extracted-plugins.test.ts` (NEW) — verifies `extractApiRoutes()` emits routes for `messaging`/`projects` from `../bakin-bits-official/` with the `x-bakin-source: "extracted"` marker, and that the validator skips them. Required given the risk register flags this path.
- Manual smoke: every primary UI path works. `curl /api/docs | jq '.paths | length'`.

**Rollback.** Reverting deletions is straightforward.

---

### T18 — Fail-closed flip + final OpenAPI snapshot

**Goal.** Validator becomes binary. Pristine OpenAPI committed.

**Touched files.**
- `scripts/docs/route-contract-check.ts` — flip warn → error. Exits non-zero if any in-repo + core public route fails. Extracted plugins remain exempt with a single-line stdout note.
- `docs/public/openapi.json` — regenerated.
- `CLAUDE.md` — "Typed Route Contracts" Key Patterns entry, if not already added in T17.

**Acceptance.**
- `bun run docs:check` exits 0 on a clean tree.
- `bun run docs:check` exits non-zero on intentional regression (verified locally; not committed).
- `docs/public/openapi.json` committed snapshot is golden.

**Verification.** Full gate. Validate via local intentional regression → revert.

**Rollback.** One-line revert.

---

## 5. Per-commit verification gate

Every task ends with:

```bash
bun run build
bun run typecheck
bun test --isolate
bun run docs:check     # warnings allowed before T18
```

T1–T17: warnings are an OK exit code. T18: warnings → errors → exit non-zero on missing schemas.

Smoke checks performed manually after **checkpoints only** (foundation, all-plugins-done, all-core-done): `bun run dev`, exercise primary UI paths.

## 6. Out-of-scope explicitly

- Migrating `messaging` and `projects` source (sibling-repo follow-up).
- Adding new routes or new plugin features.
- Changing the on-disk shape of `~/.bakin/`.
- Backwards-compatibility shims past T17.
- Renaming exec tools, hooks, or CLI commands.
- Touching `packages/adapter-openclaw` or `packages/adapter-antfly` internals.

## 7. Risk register

| Risk                                                                                  | Likelihood | Mitigation                                                                                                         |
|---------------------------------------------------------------------------------------|------------|--------------------------------------------------------------------------------------------------------------------|
| Dispatcher refactor (T4) breaks an obscure route handler under hot-reload             | Medium     | T4 keeps both registry and legacy file-routed paths via the explicit precedence rule; smoke before checkpoint; per-plugin tests catch regressions. |
| Zod 4 `z.toJSONSchema` quirks (refs, recursive types) trip up OpenAPI emission        | Medium     | T3 unit tests cover converter directly before any plugin migrates.                                                 |
| `team` plugin (29 routes) reveals broad missing schemas across agent operations       | Low        | T11 budgeted 1.5×; schema reuse via `plugins/team/types.ts`.                                                       |
| SSE / file routes break when output validation runs                                   | Low        | Validator only runs on JSON content types.                                                                         |
| Hot reload (`dev:plugin:reload`) doesn't propagate schema changes to live OpenAPI     | Medium     | T5 wires `/api/docs` to invalidate cache on the SSE event; manual check at all-plugins-done checkpoint.            |
| Extracted plugin docs regress when `extractApiRoutes` callers narrow                  | Medium     | T17 includes a dedicated test (`tests/docs/extracted-plugins.test.ts`) verifying scoped behavior.                  |
| Adapter mapping (`input → body`, `output → responses[200]`) misroutes during T4–T16   | Low        | T4 has dedicated adapter test; per-plugin tests catch divergence.                                                  |
| `/api/docs` self-reference produces recursive OpenAPI                                 | Low        | T5 + T16 declare a permissive `openApiDocumentSchema` for `/api/docs` response; cache-only handler.                |

## 8. Doc / knowledge updates (anchored to T17/T18)

Per SPEC §9:
- `CLAUDE.md` — append Key Patterns entry "Typed Route Contracts."
- `.claude/knowledge/plugin-system.md` — replace plugin route registration section.
- `.claude/knowledge/repo-architecture.md` — note `packages/host/src/core-routes/`.
- `.claude/knowledge/search-system.md` — `searchRoute({ table })` factory.
- `docs/plugin-authoring.md` — full route example using `defineRoute`.

## 9. Open questions before kickoff

None blocking. Confirmed during interview:
- Source-of-truth: declarative `routes` field + runtime registry.
- Schema technology: Zod-only, validate input + dev-test output.
- Type hierarchy: `RouteContext` → `PluginContext` / `CoreContext`.
- Validation rollout: warn → fail-closed at T18.
- Migration window: legacy `ctx.registerRoute` adapts during T1–T16, deleted in T17.
- Extracted plugins: deferred to sibling-repo follow-up; emitted to OpenAPI via `extractApiRoutes` with explicit markers; exempt from validator.
- Routing precedence in `server.ts`: registry → legacy file-routed (deleted T17) → static/SPA fallback.
