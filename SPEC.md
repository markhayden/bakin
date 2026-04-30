# SPEC — OpenAPI from typed route contracts

Branch: `feat/route-contracts` (cut fresh from `main`).

## 1. Objective

Replace the current OpenAPI generator's incomplete metadata + source-scan + manifest-list system with a single source of truth: every HTTP route — plugin and core — is declared as a typed, declarative route contract on the plugin definition. The same contract drives:

- runtime request validation (params/query/body, auto-parsed via Zod)
- runtime response validation in dev/test (per declared status)
- OpenAPI 3.1 generation (via `z.toJSONSchema`)
- `docs:check` enforcement that public routes have non-fallback schemas
- `/api/docs` returning the live OpenAPI document built from the **runtime** registry (reflects installed surface, including user plugins)
- `docs/public/openapi.json` reflecting the **bundled** surface (core + 8 in-repo plugins) for the docs site. `messaging` and `projects` exist in this repo only as `plugins/{messaging,projects}/dist/` build artifacts — their source lives in `../bakin-bits-official/`. They continue to be emitted via the legacy `extractApiRoutes` source-scan fallback against the sibling repo, marked `x-bakin-source: "extracted"` in the OpenAPI document, and exempt from the validator's schema requirements until a sibling-repo follow-up migrates them.

When done, both documents are accurate and `docs:check` fails closed if any public bundled route ships without typed schemas.

Out of scope: backwards compatibility of the *final* shape, deprecation shims past the migration window, allow-lists for unmigrated routes. Single user, single machine — clean cut at the *end* of the migration. During the migration window (commits 1–16) the old `ctx.registerRoute` path coexists so every commit builds green.

## 2. Architecture

### Source of truth: declarative routes

Routes are **declarative**, not imperatively registered. Each plugin (and the synthetic core plugin) exposes a `routes` field of route contracts on its plugin definition (always authored via `defineRoute` / `defineCoreRoute` for inference — never as a bare `APIRoute[]` annotation). The host reads `plugin.routes` and registers them into the dispatcher table **before** `activate(ctx)` runs. `activate()` is reserved for side effects only (timers, watchers, exec tools, health checks, hook registrations, search content types).

`ctx.registerRoute(...)` is **removed in commit 17** (after every plugin and every core route has migrated). Until then it remains as a thin adapter that funnels into the same registry. **Adapter mapping during migration:** legacy `route.input` is registered as `body` (assumed `application/json`); legacy `route.output` is registered as `responses[200]`; routes without `input`/`output` are still registered but appear in the validator's warning list until they migrate to the declarative shape. There is no permanent dual-API surface — only a migration-window coexistence.

The synthetic core plugin lives at `packages/host/src/core-routes/` and exposes `coreRoutes: APIRoute[]`.

### Type hierarchy

```ts
interface RouteContext {
  runtime: AgentRuntimeAdapter
  search: SearchAPI
  tasks: PluginTaskService
  hooks: HookAPI
  activity: ActivityAPI
  storage: StorageAdapter
}

interface PluginContext extends RouteContext {
  pluginId: string
  getSettings<T>(): T
  registerExecTool(...): void
  registerHealthCheck(...): void
  // existing per-plugin surface
}

interface CoreContext extends RouteContext {
  pluginManifests: PluginRegistry
  systemSettings: SystemSettingsAPI
  // host-only surface
}
```

Plugin route handlers receive `PluginContext`. Core route handlers receive `CoreContext`. The dispatcher's route table is uniform; only the bound context differs by registration origin.

### Route shape

```ts
type ParsedInput<P, Q, B> =
  & (P extends undefined ? {} : { params: P })
  & (Q extends undefined ? {} : { query: Q })
  & (B extends undefined ? {} : { body: B })

interface APIRoute<
  C extends RouteContext = RouteContext,
  P = undefined,
  Q = undefined,
  B = undefined,
> {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  summary: string
  description?: string

  params?: z.ZodType<P>
  query?: z.ZodType<Q>
  body?:
    | z.ZodType<B>
    | { contentType: 'application/json'; schema: z.ZodType<B> }
    | { contentType: 'multipart/form-data'; schema?: z.ZodType }
    | { contentType: '*/*'; schema?: z.ZodType }
    | { contentType: 'none' }                       // explicit "no body consumed"

  responses: Partial<Record<HttpStatus, ResponseSpec>>

  visibility?: 'public' | 'internal'                // default 'public'
  stability?: 'stable' | 'beta' | 'experimental' | 'deprecated'   // default 'stable'
  permissions?: string[]
  examples?: DocsExample[]
  operationId?: string
  tags?: string[]

  handler: (
    req: Request,
    ctx: C,
    parsed: ParsedInput<P, Q, B>,
  ) => Response | Promise<Response>
}

interface JsonResponseSpec { contentType: 'application/json'; schema: z.ZodType }
interface NoContentResponseSpec { contentType: 'none' }                            // 204, redirects
interface NonJsonResponseSpec {
  contentType:
    | 'text/event-stream'
    | 'text/html'
    | 'text/plain'
    | 'application/octet-stream'
    | 'image/png' | 'image/jpeg' | 'image/svg+xml'
    | (string & {})                                    // escape hatch, validator ignores
  schema?: z.ZodType
}

type ResponseSpec =
  | z.ZodType                                          // shorthand: equivalent to JsonResponseSpec with this schema
  | JsonResponseSpec
  | NoContentResponseSpec
  | NonJsonResponseSpec
```

Discriminated by `contentType`. JSON and "none" are exact literals; non-JSON enumerates the content types Bakin actually emits today plus an escape hatch for future types. The discriminant keeps TS narrowing honest and prevents the broad-string-overlap problem.

`ParsedInput<P, Q, B>` is a **conditional intersection**: only declared schemas appear as keys. A route with no `params`, only `query`, no `body` produces `parsed: { query: Q }`. Runtime construction of `parsed` matches this shape exactly — undeclared properties are omitted, not set to `undefined`. Type and runtime stay aligned.

The `R` (success-response) generic is intentionally absent. Output validation is runtime-only against `responses[status].schema`; compile-time response typing is not worth the type complexity.

### Inference helpers (required)

To get per-route type inference inside arrays, plugins are authored via const-generic helpers. Bare `routes: APIRoute[]` annotations are forbidden — they widen and break inference.

```ts
// plugin authors
import { definePlugin, defineRoute } from '@bakin/sdk'

export default definePlugin({
  id: 'tasks',
  name: 'Tasks',
  version: '2.1.0',
  routes: [
    defineRoute({
      path: '/',
      method: 'POST',
      body: createTaskBody,
      responses: { 200: createTaskResponse },
      handler: async (req, ctx, { body }) => { /* body is typed; ctx is PluginContext */ ... },
    }),
  ],
  activate(ctx) { /* side effects */ },
})

// core route subject modules
import { defineCoreRoute } from '@bakin/host/core-routes'

export const agentRoutes = [
  defineCoreRoute({
    path: '/api/agents/start',
    method: 'POST',
    body: startAgentBody,
    responses: { 200: startAgentResponse },
    handler: async (req, ctx, { body }) => { /* ctx is CoreContext */ ... },
  }),
]
```

`defineRoute` binds `C = PluginContext`. `defineCoreRoute` binds `C = CoreContext`. Both are identity functions with const generics. Authors **must** use them.

### Query coercion

`query` schemas are parsed from `Record<string, string | string[]>` extracted from `URLSearchParams` (multiple identical keys → array). Authors who want numbers/booleans use `z.coerce.number()` / `z.coerce.boolean()`. The dispatcher does **not** auto-coerce.

### Body content types

| Declaration                                                        | Dispatcher behavior                                                |
|--------------------------------------------------------------------|--------------------------------------------------------------------|
| `body: someZodSchema` (shorthand)                                  | Parse `application/json` body via `someZodSchema`. Empty/wrong type → 400. |
| `body: { contentType: 'application/json', schema }`                | Same as shorthand, explicit.                                       |
| `body: { contentType: 'multipart/form-data', schema? }`            | No auto-parse. Handler reads `req.formData()`. If schema present, handler invokes `parseMultipart(req, schema)` helper. Public OK without schema (binary uploads). |
| `body: { contentType: '*/*', schema? }`                            | Raw passthrough. Handler reads `req.body` / `req.arrayBuffer()`.   |
| `body: { contentType: 'none' }`                                    | Dispatcher rejects any non-empty body with 415. No `parsed.body`.  |
| `body` omitted                                                     | Dispatcher does not read body. Handler does not receive `parsed.body`. Incoming body is silently ignored. |

**`{ contentType: 'none' }` is the explicit way to say "this route consumes no body"** (e.g., POST `/api/dispatch`). It documents intent in OpenAPI and is enforced by the dispatcher.

### Response validation

Dispatcher behavior after handler returns:

1. Inspect `response.status`.
2. Look up `responses[status]`.
3. Not declared and `NODE_ENV !== 'production'` → log warning (test → fail).
4. Declared as `{ contentType: 'none' }` or non-JSON → no validation, pass through.
5. Declared as Zod schema or `{ schema }` with JSON content → `safeParse(await response.clone().json())`. On mismatch in non-prod → log warning (test → fail). Production never parses.

Errors thrown inside handlers convert to `500 { error }` and validate against `responses[500]` if declared.

### Auto-emitted error envelope

Shared error schema in `packages/core/src/openapi/errors.ts`:

```ts
const errorEnvelope = z.object({
  error: z.string(),
  issues: z.array(z.unknown()).optional(),
})
```

The dispatcher emits `400 { error: 'invalid input', issues }` automatically on params/query/body parse failure, and `415 { error }` on body content-type mismatch. OpenAPI emits a global `400` response for every route that declares any of `params|query|body`. The global `415` is emitted **only** for routes with a `body` declaration (params/query-only routes can't trigger it). Authors don't repeat these per-route.

### Search-generated routes

Today `ctx.search.registerFileBackedContentType()` auto-wires a `GET /search` route. Replaced by a **route factory** plugins include in their `routes` array:

```ts
import { searchRoute } from '@bakin/sdk'

routes: [
  // ... domain routes
  searchRoute({ table: 'tasks' }),
],
```

`searchRoute` returns an `APIRoute<PluginContext, ...>` with `query` and `responses` schemas bound at module scope. The handler uses `ctx.search` at request time — no closure over `activate()`-initialized services. OpenAPI emission picks it up like any other route. Internal default for the search adapter's table-management routes (`registerContentType`-flavor) — they remain hooks, not HTTP.

### Handler / activate ordering

Routes are registered **before** `activate(ctx)` runs. Handlers must use `ctx` for every service — never close over module-scope state initialized in `activate()`. Module-scope schemas/factories are fine; module-scope service handles set up in `activate()` are forbidden.

### Core route registration

Per-subject modules under `packages/host/src/core-routes/`:

```
packages/host/src/core-routes/
  index.ts          — barrel, exports coreRoutes: APIRoute<CoreContext>[]
  agents.ts         — /api/agents/*
  agent-packages.ts — /api/agent-packages/*
  packages.ts       — /api/packages/*
  plugins.ts        — /api/plugins/{install,link,unlink,upgrade,remove,manifest,assets}
  dispatch.ts       — /api/dispatch
  settings.ts       — /api/settings, /api/plugin-settings/*
  events.ts         — /api/events, /api/dev/events, /api/dev/notify
  misc.ts           — /api/version, /api/paths, /api/state, /api/search, /api/reindex,
                      /api/activity*, /api/internal/continuation, /api/exec-tools/:toolName,
                      /api/memory/log, /api/curated, /api/assets/:path, /api/docs
```

`server.ts` reads `coreRoutes` and registers them at boot, before user plugins. Files at `packages/host/src/api/**/*.ts` collapse: their handler bodies move into the matching subject module. `dispatchWebHandler` is replaced by registry lookup.

### Registry & dispatch

Single `RouteRegistry` at `packages/core/src/routing/registry.ts`.

- **Storage:** radix-style `Map<method, RadixNode>` indexed by full path (plugin routes prefixed with `/api/plugins/<id>`).
- **Insertion:** `register(route)` validates `<method, fullPath>` is not already registered. Duplicate → throws at boot.
- **Path matching:** literal segments take precedence over `:param`. `:param` segments take precedence over wildcard. No ambiguity allowed at boot.
- **Operation identity:** generated `operationId = <scope>.<methodLower>.<slug(path)>` unless declared. Duplicate operationIds → throws at boot.
- **Path normalization for OpenAPI:** `:id` → `{id}`. Path params auto-emitted into OpenAPI `parameters` with type derived from the `params` schema. The `string` fallback for `:param` segments without a `params` schema applies only to **internal** routes and **unmigrated** routes (commits 1–16); the validator (Section "Validator") rejects this state for public bundled routes at commit 18.
- **Tags:** plugin name (or `Core`); overridable via `route.tags`.
- **Reset:** `clearRegistry()` for tests. Tests that exercise the dispatcher must call this in `beforeEach`.
- **Visibility:** validator enforces `visibility !== 'internal'`. Internal routes are emitted to OpenAPI with `x-bakin-visibility: 'internal'` and skipped by the validator. Stability is orthogonal — `experimental` public routes still require schemas.
- **Routing precedence in `server.ts`:** during the migration window the request handler tries paths in this order: (1) registry match for any registered route (plugin or core); (2) legacy file-routed fallback under `packages/host/src/api/**` for unmigrated core routes; (3) static asset / SPA shell fallback. Step 2 is deleted in commit 17 once every core route lives in the registry.

### Docs generation: static vs live

| Document                          | Built by                  | Includes                               |
|-----------------------------------|---------------------------|----------------------------------------|
| `docs/public/openapi.json`        | `scripts/docs/generate.ts`| Core + in-repo plugins (10).           |
| `/api/docs` (HTTP route)          | runtime registry          | Core + every plugin actually installed (in-repo + linked + user-installed under `~/.bakin/plugins/`). |

**Static** path:
1. Import every in-repo plugin module (`plugins/<id>/index.ts`) statically. Read `plugin.routes`.
2. Read `coreRoutes`.
3. Build OpenAPI 3.1 doc via `z.toJSONSchema` + helpers. Run validator.
4. Write `docs/public/openapi.json`.

`activate()` is never invoked.

**Runtime** path:
1. At server boot, after every plugin (core + in-repo + user) has been registered into the same `RouteRegistry`, build the OpenAPI document **once** from the registry and cache it.
2. `/api/docs` returns the cached document.
3. On `dev:plugin:reload` (hot reload), invalidate cache and rebuild.

The two are intentionally different — the static doc is for a fixed shipped surface; the live doc is for "what does this Bakin actually expose right now."

### `generateDocs(contentDir)`

Deleted. The legacy markdown writer at `~/.bakin/docs/API.md` was tech debt; the docs site is the canonical view.

### Validator

`scripts/docs/route-contract-check.ts` walks the **bundled** surface (`coreRoutes + everyInRepoPluginRoutes`) and reports any **public** route that:

- Has a `body` declaration but the declaration is JSON-flavored (`z.ZodType` or `{ contentType: 'application/json', schema }`) without a schema (impossible by type but checked defensively).
- Has zero declared `responses[2xx]` keys.
- Has a `2xx` response with `application/json` content but no schema.
- Has `:param` segments in `path` but no `params` schema.

The validator does **not** require `body` based on method. Routes that consume no body simply omit `body` (or declare `{ contentType: 'none' }` for explicit documentation). DELETE routes that consume bodies declare `body` like any POST.

`internal` routes exempt. During migration: warnings, exit 0. Final commit (18): errors, exit 1.

`multipart/form-data` and `*/*` body declarations without schemas are **allowed** for public routes (binary uploads). They're emitted to OpenAPI with the appropriate content type and `format: binary`. The validator does not flag them.

## 3. Commands

```bash
bun run build
bun run docs:build
bun run docs:check
bun run typecheck

bun test --isolate
bun test tests/path/to/foo.test.ts --isolate

bun run dev
bun run dev:mock
```

No new top-level commands. `docs:check` gains the new validator output.

## 4. Project structure changes

### Added

- `packages/host/src/core-routes/{index,agents,agent-packages,packages,plugins,dispatch,settings,events,misc}.ts`
- `packages/core/src/routing/{registry,define,types}.ts` — `RouteRegistry`, `defineRoute`, `defineCoreRoute`, `definePlugin`, route types.
- `packages/core/src/openapi/{generate,zod-to-openapi,errors}.ts` — converter + error envelope + OpenAPI doc builder.
- `packages/core/src/search/route.ts` — `searchRoute({ table })` factory.
- `scripts/docs/route-contract-check.ts` — bundled-surface walker / validator.
- Re-exports of `definePlugin`, `defineRoute`, `searchRoute` from `@bakin/sdk`.

### Modified

- `packages/core/src/plugin-types.ts` — `BakinPlugin` gains `routes?: APIRoute[]` (optional during migration; required behavior post-17). `PluginContext.registerRoute` becomes a thin adapter into the registry until commit 17.
- `packages/core/src/docs/metadata.ts` and `packages/sdk/src/metadata/index.ts` — duplicated `RouteContract` consolidated; SDK re-exports from core.
- `scripts/docs/generate.ts` — replace OpenAPI emission with registry-driven path; delete `schemaFromParamsHint`, `defaultRequestBody`, `schemaForParamHint`, generic-fallback emission.
- `server.ts` — read `coreRoutes` + plugin `.routes` + adapter-registered routes, build registry, dispatch via registry.
- Every `plugins/<id>/index.ts` — convert to `export default definePlugin({...routes: [...] })` shape.
- Every `plugins/<id>/bakin-plugin.json` — `contributes.apiRoutes` field removed (in commit 17 cleanup).

### Deleted (commit 17)

- `src/core/api-docs.ts` — `CORE_ROUTES`, `coreRoute()`, `routeDocs[]`, `registerRouteDoc()`, `getAllRoutes()`, `generateDocs(contentDir)`.
- `scripts/docs/source-scan.ts` — `extractApiRoutes()` and `getApiRoutes()` (manifest-first + fallback). Plugin-manifest scanning stays for exec-tools and CLI commands; route extraction goes.
- `packages/host/src/api/_adapter.ts` — `dispatchWebHandler` replaced by registry-based dispatcher.
- `ctx.registerRoute` from `PluginContext`.

## 5. Code style

- Zod schemas live at module scope, named `<verb><resource>Body` / `<verb><resource>Response` (e.g., `createTaskBody`, `createTaskResponse`). Reuse across handlers freely.
- One `defineRoute({...})` per route. No helper wrappers that hide the contract.
- Handler body holds business logic only. Manual `if (!field) return 400` blocks delete; dispatcher handles it.
- `summary` (≤80 chars) and `description` (one paragraph max) required on every public route. `visibility`, `stability`, `permissions` set explicitly when non-default.
- `examples` strongly preferred for routes with non-trivial bodies.
- Per CLAUDE.md: no comments unless explaining non-obvious *why*. The schema *is* the documentation.

## 6. Testing strategy

Per CLAUDE.md `Testing Rules — CRITICAL`. Every test mocks both content-dir resolvers and OpenClaw home before imports.

### Per migration commit

Each plugin migration updates its test file alongside the source:

- Tests of route handlers now invoke through the dispatcher (with the registry populated from `plugin.routes`). Hand-built request bodies still work; manual 400-validation cases collapse to one dispatcher-level case.
- Add per-plugin: registry contains the expected method+path entries with non-fallback schemas.
- Output validation in test (`NODE_ENV=test`): mismatches fail the test.
- Undeclared response status returned by a handler in test: fails the test.

### New foundational tests

- `tests/core/route-registry.test.ts` — duplicate registration throws; path precedence; clear works.
- `tests/core/route-dispatcher.test.ts` — params/query/body parse failure → 400 with issues; body content-type mismatch → 415; response 200 mismatch in dev → warning; undeclared response status in dev → warning; happy path → typed `parsed` reaches handler with only declared keys present; missing route → 404; `body: { contentType: 'none' }` rejects non-empty bodies.
- `tests/docs/openapi-from-contracts.test.ts` — given a stub plugin with typed contracts, generated OpenAPI document has correct `paths`, `parameters`, `requestBody`, `responses`, `tags`, `operationId`. Snapshot.
- `tests/docs/route-contract-check.test.ts` — validator returns errors on missing schemas in public routes; ignores internal; clean registry passes; multipart with no schema passes; `:id` path with no `params` schema fails.

### Final-commit gate

`bun run docs:check` exits 0 only if every public bundled route has the required schemas. Single CI signal.

## 7. Commit strategy

Single feature branch `feat/route-contracts`. Eighteen atomic commits. Every commit: `bun run build && bun run typecheck && bun test --isolate && bun run docs:check` all pass (warnings allowed before commit 18).

**Sequencing principle:** the legacy `ctx.registerRoute` path is preserved as a thin adapter into the registry through commits 1–16. It is removed in commit 17 only after every plugin and every core route has migrated. This keeps every intermediate commit green.

| #  | Commit                                                                                                       | State at end                                                                       |
|----|--------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| 1  | refactor(core): types, helpers, plugin shape — `RouteContext`/`PluginContext`/`CoreContext`, `defineRoute`/`defineCoreRoute`/`definePlugin`, optional `BakinPlugin.routes` | New types exist; runtime unchanged                                                 |
| 2  | feat(core): route registry — radix matching, duplicate detection, operation-id derivation                    | Registry module exists, no callers yet                                             |
| 3  | feat(core): Zod→OpenAPI converter + shared error envelope                                                    | Converter usable in tests; OpenAPI emission ready                                  |
| 4  | feat(core): registry-driven dispatcher with auto-validate; legacy `ctx.registerRoute` adapts into registry   | All routes (old + new shape) flow through one dispatcher                           |
| 5  | feat(docs): route-contract validator in warn mode; `/api/docs` from runtime registry                         | Validator surfaces unmigrated routes as warnings                                   |
| 6  | refactor(tasks): declarative routes with typed contracts                                                     | First plugin migrated; warning count drops                                         |
| 7  | refactor(workflows): declarative routes with typed contracts                                                 |                                                                                    |
| 8  | refactor(schedule): declarative routes with typed contracts                                                  |                                                                                    |
| 9  | refactor(assets): declarative routes with typed contracts                                                    |                                                                                    |
| 10 | refactor(memory): declarative routes with typed contracts                                                    |                                                                                    |
| 11 | refactor(team): declarative routes with typed contracts                                                      |                                                                                    |
| 12 | refactor(models): declarative routes with typed contracts                                                    |                                                                                    |
| 13 | refactor(health): declarative routes with typed contracts                                                    | All 8 in-repo plugins migrated                                                     |
| 14 | refactor(core-routes): typed contracts for /api/agents/*                                                     |                                                                                    |
| 15 | refactor(core-routes): typed contracts for dispatch, settings, agent-packages, packages                      |                                                                                    |
| 16 | refactor(core-routes): typed contracts for plugins + misc                                                    | Every in-repo route registered declaratively; legacy path has zero callers         |
| 17 | refactor(docs): retire `ctx.registerRoute`, `dispatchWebHandler`, `CORE_ROUTES`, manifest `apiRoutes`; scope `extractApiRoutes` to extracted plugins; delete `generateDocs(contentDir)` | Dead code removed; extracted-plugin scanner retained                               |
| 18 | feat(docs): flip route-contract validator to fail-closed (in-repo + core only; extracted plugins exempt); regenerate `docs/public/openapi.json` | Enforcement on; pristine OpenAPI snapshot                                          |

Natural rollback targets: any commit between 4–13 (revert one plugin), 14–16 (revert one core slice). Foundation (1–3) is interlocked but each commit is self-contained. Final flip (18) is one-line revert if downstream tooling breaks.

## 8. Boundaries

### Always
- Use `definePlugin` + `defineRoute` (or `defineCoreRoute`) helpers. Never annotate `BakinPlugin` or `APIRoute[]` directly.
- Mock both content-dir resolvers and OpenClaw home in every test that touches storage.
- Keep route handlers free of manual input validation — dispatcher handles it via Zod.
- Co-locate Zod schemas next to the route declaration. No schemas in side files unless reused across plugins.
- Use `ctx` services inside handlers. Module-scope state initialized in `activate()` is unsafe — routes register first.
- Run `bun run build`, `bun run typecheck`, `bun test --isolate`, `bun run docs:check` before each commit.
- Update `.claude/knowledge/` docs that reference the old metadata/source-scan flow.
- Update `docs/plugin-authoring.md` with the new declarative route shape.

### Ask first
- Anything that changes the on-disk shape of `~/.bakin/`. (This work shouldn't, but flag if it does.)
- Adding a new top-level dependency. (Zod is already in.)

### Never
- Leave the `ctx.registerRoute` adapter in place past commit 17.
- Use `any` to satisfy TypeScript when narrowing. Fix the type chain.
- Hand-maintain a route list anywhere — declarative `routes` field is the only source.
- Use the source-scan AST extractor for routes after commit 17. (Exec-tool / CLI extraction stays.)
- Skip the `--isolate` flag on test runs.
- Close over services initialized in `activate()` from a route handler.
- Require `body` schemas based on HTTP method alone. Authors declare `body` (or `{ contentType: 'none' }`) explicitly.

## 9. Knowledge / docs updates

Touched as part of commit 17 or 18:

- `.claude/knowledge/plugin-system.md` — update plugin route registration: `routes` array, `definePlugin`/`defineRoute`, removal of `ctx.registerRoute`.
- `.claude/knowledge/repo-architecture.md` — note `packages/host/src/core-routes/` is the source of truth for core HTTP routes.
- `.claude/knowledge/search-system.md` — replace `registerFileBackedContentType` auto-route description with `searchRoute({ table })` factory.
- `docs/plugin-authoring.md` — show a real route example using `params`/`query`/`body`/`responses` Zod schemas with `ParsedInput` typing via `defineRoute`.
- `CLAUDE.md` — append a Key Patterns entry for "Typed Route Contracts" pointing at the registry, `definePlugin`/`defineRoute`, and `z.toJSONSchema` flow.
- `docs/public/openapi.json` — regenerated from contracts in commit 18.

## 10. Acceptance criteria

- `bun run build && bun run typecheck && bun test --isolate && bun run docs:check` all pass on commit 18.
- `docs:check` exits non-zero if any public bundled route lacks request-side schemas (where applicable per the validator rules) or `responses[2xx]` schemas.
- `docs/public/openapi.json` contains zero `additionalProperties: true` fallback emissions for in-repo routes (core + 8 in-repo plugins). Extracted plugins (`messaging`, `projects`) may still emit fallback schemas; their entries carry `x-bakin-source: "extracted"` and `x-bakin-validator-exempt: true`.
- `src/core/api-docs.ts`, `extractApiRoutes()` in `source-scan.ts`, `dispatchWebHandler`, `ctx.registerRoute`, and every `contributes.apiRoutes` array in `bakin-plugin.json` are deleted.
- Every plugin exports via `definePlugin({...})` with a `routes` array of `defineRoute(...)` entries.
- A request with an invalid params/query/body returns `400 { error, issues }` from the dispatcher, not from a hand-coded check.
- A request to a route declaring `body: { contentType: 'none' }` with a non-empty body returns `415` from the dispatcher.
- A handler whose response shape diverges from its declared `responses[200]` schema fails its own test under `NODE_ENV=test`.
- A handler that returns a status not declared in `responses` fails its own test under `NODE_ENV=test`.
- `/api/docs` returns the live OpenAPI document built from the in-memory registry, cached at boot and rebuilt on `dev:plugin:reload`.
- `docs/public/openapi.json` is built from the bundled surface only (core + in-repo plugins), without invoking `activate()`.
