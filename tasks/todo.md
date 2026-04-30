# TODO — OpenAPI from typed route contracts

Flat checklist mirroring [`plan.md`](./plan.md). Check items as you land them. Each task = one commit on `feat/route-contracts`.

## Branch setup
- [ ] Cut `feat/route-contracts` from `main`

## Foundation (T1–T5)

### T1 — Types, helpers, plugin shape
- [ ] `packages/core/src/routing/types.ts` — `RouteContext`, `APIRoute<C, P, Q, B>`, `ParsedInput<P, Q, B>`, `JsonResponseSpec`, `NoContentResponseSpec`, `NonJsonResponseSpec`
- [ ] `packages/core/src/routing/define.ts` — `defineRoute`, `defineCoreRoute`, `definePlugin`
- [ ] `packages/core/src/plugin-types.ts` — add `routes?: APIRoute[]` to `BakinPlugin`
- [ ] Consolidate `RouteContract` between `packages/core/src/docs/metadata.ts` and `packages/sdk/src/metadata/index.ts`
- [ ] `packages/sdk/src/index.ts` — re-export `definePlugin`, `defineRoute`, `searchRoute`
- [ ] `tests/core/routing-types.test.ts` — type-level inference assertions
- [ ] Gate
- [ ] Commit: `refactor(core): RouteContext/PluginContext/CoreContext hierarchy + definePlugin/defineRoute helpers`

### T2 — Route registry
- [ ] `packages/core/src/routing/registry.ts` — `RouteRegistry` with radix matching, duplicate detection, `clear()`, `match()`, `all()`
- [ ] `packages/core/src/routing/operation-id.ts`
- [ ] `tests/core/route-registry.test.ts`
- [ ] Gate
- [ ] Commit: `feat(core): route registry with duplicate detection and path matching`

### T3 — Zod→OpenAPI converter + error envelope
- [ ] `packages/core/src/openapi/zod-to-openapi.ts` — wraps `z.toJSONSchema`; `:id` → `{id}`
- [ ] `packages/core/src/openapi/errors.ts` — `errorEnvelope`, global `400`/`415` builders
- [ ] `packages/core/src/openapi/operation.ts` — single-route Operation builder
- [ ] `tests/docs/zod-to-openapi.test.ts` — golden snapshots covering JSON, multipart, none-body, SSE, mixed-status
- [ ] Gate
- [ ] Commit: `feat(core): Zod→OpenAPI converter and shared error envelope`

### T4 — Dispatcher + legacy `ctx.registerRoute` adapter
- [ ] `packages/core/src/routing/dispatcher.ts` — extract path params, parse query, parse body, call handler, validate response
- [ ] Modify `server.ts` (repo root) — `/api/*` flows through dispatcher with precedence: registry → legacy file-routed → static/SPA
- [ ] Modify `src/lib/plugin-registry.ts` — `ctx.registerRoute` adapts (`input → body`, `output → responses[200]`) and writes into the registry
- [ ] Modify `packages/host/src/api/_adapter.ts` — `dispatchWebHandler` invoked only from precedence step 2
- [ ] `tests/core/route-dispatcher.test.ts` — 400/415/404, happy path, response-validation, `body: { contentType: 'none' }`
- [ ] `tests/core/route-dispatcher-adapter.test.ts` — legacy flows through adapter
- [ ] Smoke (`bun run dev:mock`): `/api/version`, `/api/agents`, `/api/plugins/tasks/`
- [ ] Gate
- [ ] Commit: `feat(core): registry-driven dispatcher with auto-validate; legacy ctx.registerRoute adapter`

### T5 — Validator (warn) + `/api/docs` from registry
- [ ] `scripts/docs/route-contract-check.ts` — bundled-surface validator (in-repo + core only; extracted exempt)
- [ ] Wire into `bun run docs:check`
- [ ] `packages/host/src/api/docs-runtime.ts` — live OpenAPI from registry, cached at boot, invalidated on `dev:plugin:reload`
- [ ] Update `src/core/api-docs.ts` `/api/docs` route to delegate
- [ ] Declare `/api/docs` route's own response with `openApiDocumentSchema` (avoid self-reference recursion)
- [ ] `tests/docs/route-contract-check.test.ts`
- [ ] `tests/api/api-docs-runtime.test.ts`
- [ ] Gate (warnings expected; exit 0)
- [ ] Commit: `feat(docs): route-contract validator (warn); /api/docs from runtime registry`

### CHECKPOINT — Foundation complete
- [ ] `bun run dev` smoke: tasks UI, settings, agents start/stop
- [ ] `curl http://localhost:3737/api/docs | jq '.paths | keys | length'`
- [ ] Record warning baseline: `bun run docs:check 2>&1 | grep -c "missing"`

## Plugin migrations (T6–T13) — 8 in-repo plugins

### T6 — `tasks` (12 routes)
- [ ] Module-scope schemas: `createTaskBody`, `createTaskResponse`, `moveTaskBody`, `assignTaskBody`, `logProgressBody`, `blockTaskBody`, `setDependencyBody`, `reorderBody`, `completeTaskBody`, `taskListResponse`, `taskDetailsResponse`
- [ ] Convert `plugins/tasks/index.ts` to `definePlugin({...routes: [defineRoute(...)] })`
- [ ] Drop manual 400-validation in handlers
- [ ] Update `tests/plugins/tasks/*.test.ts`
- [ ] Smoke: tasks UI under `bun run dev:mock`
- [ ] Diff openapi.json
- [ ] Gate
- [ ] Commit: `refactor(tasks): declarative routes with typed contracts`

### T7 — `workflows` (18 routes)
- [ ] Schemas (gate, skip-step, start, submit); reuse from `plugins/workflows/types.ts`
- [ ] Convert + tests + smoke (workflow start + step gate) + gate
- [ ] Commit: `refactor(workflows): declarative routes with typed contracts`

### T8 — `schedule` (10 routes)
- [ ] Schemas + convert + tests + smoke + gate
- [ ] Commit: `refactor(schedule): declarative routes with typed contracts`

### T9 — `assets` (11 routes)
- [ ] Asset upload uses `body: { contentType: 'multipart/form-data' }`
- [ ] Convert + tests + smoke (asset upload + preview) + gate
- [ ] Commit: `refactor(assets): declarative routes with typed contracts`

### T10 — `memory` (16 routes; split across `lib/routes/*.ts`)
- [ ] Update each `plugins/memory/lib/routes/*.ts` to export `defineRoute(...)` entries
- [ ] `index.ts` aggregates into `routes` array
- [ ] Schemas + tests + smoke (memory dashboard) + gate
- [ ] Commit: `refactor(memory): declarative routes with typed contracts`

### T11 — `team` (29 routes — largest)
- [ ] Reuse schemas (agent CRUD, persona, contact, channel)
- [ ] Convert + tests + smoke (team settings, persona editor) + gate
- [ ] Commit: `refactor(team): declarative routes with typed contracts`

### T12 — `models` (11 routes)
- [ ] Schemas + convert + tests + smoke (models picker) + gate
- [ ] Commit: `refactor(models): declarative routes with typed contracts`

### T13 — `health` (7 routes)
- [ ] Schemas + convert + tests + smoke (doctor page) + gate
- [ ] Commit: `refactor(health): declarative routes with typed contracts`

### CHECKPOINT — All in-repo plugins migrated
- [ ] Diff `docs/public/openapi.json` — every plugin path typed
- [ ] Smoke each plugin's primary UI path
- [ ] Validator warning count: in-repo plugins = 0; remaining ≈ unmigrated core (~50)

## Core route migration (T14–T16)

### T14 — `core/agents/*` (11 routes)
- [ ] `packages/host/src/core-routes/index.ts` — barrel
- [ ] `packages/host/src/core-routes/agents.ts` — `defineCoreRoute(...)` per route
- [ ] Modify `server.ts` — register `coreRoutes` before in-repo plugins
- [ ] Tests
- [ ] Smoke: agents start/stop/restart
- [ ] Gate
- [ ] Commit: `refactor(core-routes): typed contracts for /api/agents/*`

### T15 — `core/dispatch + settings + agent-packages + packages` (~16 routes)
- [ ] `packages/host/src/core-routes/{dispatch,settings,agent-packages,packages}.ts`
- [ ] Schemas + tests + smoke + gate
- [ ] Commit: `refactor(core-routes): typed contracts for dispatch, settings, agent-packages, packages`

### T16 — `core/plugins + misc` (~22 routes)
- [ ] `packages/host/src/core-routes/{plugins,events,misc}.ts`
- [ ] SSE: `responses[200]: { contentType: 'text/event-stream' }`
- [ ] Binary: `responses[200]: { contentType: 'application/octet-stream' }` (or matching image type)
- [ ] `/api/dev/*` declare `visibility: 'internal'`
- [ ] `/api/docs` response declared with `openApiDocumentSchema`; handler reads cache only
- [ ] Tests + smoke (SSE: `curl -N /api/events`; file fetch; `/api/docs` valid OpenAPI)
- [ ] Gate
- [ ] Commit: `refactor(core-routes): typed contracts for plugins + misc`

### CHECKPOINT — Every in-repo route is declarative
- [ ] Validator warnings for in-repo + core: 0
- [ ] `messaging`/`projects` warnings remain (exempt)
- [ ] Legacy `ctx.registerRoute` has zero in-repo callers

## Cleanup + flip (T17–T18)

### T17 — Cleanup
- [ ] Delete `src/core/api-docs.ts` (`CORE_ROUTES`, `coreRoute()`, `routeDocs[]`, `registerRouteDoc()`, `getAllRoutes()`, `generateDocs(contentDir)`, `RouteDoc`)
- [ ] Delete `dispatchWebHandler` from `packages/host/src/api/_adapter.ts`. If the file is empty after the deletion, remove the file too.
- [ ] Delete file-routed core handlers under `packages/host/src/api/**/*.ts` (after deletions, only `_static.ts` and `_embedded-assets*.ts` should remain — and `_adapter.ts` only if it still has live exports)
- [ ] Delete `ctx.registerRoute` from `PluginContext` + adapter wiring in `src/lib/plugin-registry.ts`
- [ ] Delete `contributes.apiRoutes` from in-repo `bakin-plugin.json` files (8 plugins)
- [ ] Modify `scripts/docs/source-scan.ts` — delete `getApiRoutes()`
- [ ] Modify `scripts/docs/generate.ts` — remove `schemaFromParamsHint`, `defaultRequestBody`, `schemaForParamHint`, fallback emission, legacy `routeOperation` overload. Static OpenAPI: import in-repo plugin modules → read `plugin.routes` and `coreRoutes`. Extracted plugins: `extractApiRoutes()` against `../bakin-bits-official/`, marked `x-bakin-source: "extracted"` and `x-bakin-validator-exempt: true`
- [ ] Update `.claude/knowledge/plugin-system.md`
- [ ] Update `.claude/knowledge/repo-architecture.md`
- [ ] Update `.claude/knowledge/search-system.md`
- [ ] Update `docs/plugin-authoring.md`
- [ ] Update `CLAUDE.md` — Typed Route Contracts entry
- [ ] Scoped grep (production source only): `grep -rln "ctx.registerRoute" plugins/ packages/ src/ server.ts` → 0
- [ ] `grep -rln "dispatchWebHandler" plugins/ packages/ src/ server.ts` → 0
- [ ] `grep -rln "CORE_ROUTES" packages/ src/ scripts/` → 0
- [ ] `tests/docs/extracted-plugins.test.ts` — verifies extracted-plugin handling stays correct
- [ ] Gate
- [ ] Commit: `refactor(docs): retire legacy route registration; scope extractApiRoutes to extracted plugins`

### T18 — Fail-closed flip + final OpenAPI snapshot
- [ ] `scripts/docs/route-contract-check.ts` — flip warn → error
- [ ] Regenerate `docs/public/openapi.json`
- [ ] Local intentional regression test → validator catches → revert
- [ ] Gate (hard pass required)
- [ ] Commit: `feat(docs): flip route-contract validator to fail-closed; regenerate openapi.json`

## Wrap-up
- [ ] Push branch
- [ ] Open PR; link to SPEC.md and tasks/plan.md
- [ ] Mention extracted-plugin follow-up (sibling repo) in PR description
