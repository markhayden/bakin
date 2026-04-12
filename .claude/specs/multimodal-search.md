# SPEC: Multimodal Search & Antfly Feature Expansion

**Status:** Draft — awaiting confirmation
**Branch:** `feat/multimodal-search` (created at start of `/agent-skills:build`)
**Author:** Mark + Claude
**Date:** 2026-04-11
**Predecessor:** `.claude/specs/antfly-search-system.md` (the initial Antfly integration this builds on)
**Related work deferred to follow-ups:**
- [#70 — Ask Bakin: natural-language search via Antfly retrieval agent](https://github.com/markhayden/bakin/issues/70)
- `.claude/specs/antfly-graph-indexes.md` (to be authored as part of this spec)

---

## 1. Objective

Bakin's search system already does hybrid (BM25 + semantic) text search across markdown content via Antfly. Today, the **assets** plugin indexes only sidecar metadata (`description`, `tags`, `file_name`) — the actual file contents (PDFs, images, audio, video, structured data) are opaque to search. Meanwhile, several Antfly capabilities Bakin pays for in code complexity sit unused: cross-encoder reranking is configured but never wired into the query path, multimodal embedding helpers are untouched, and embedder choice is hardcoded as a single global model.

This spec covers a focused, infrastructure-only upgrade to the search backend. Every change here is **invisible to humans until consumer features ship** — but every Bakin agent immediately benefits from richer search results on the existing MCP tools (`bakin_exec_search_query`, `bakin_exec_search_similar`, etc.) the moment this lands.

In scope:

1. **Multimodal indexing of assets** — extract text from PDFs and embed images directly, so a query like "the architecture diagram with the kafka box" or "the contract that mentions Wyoming LLC formation" returns hits from file *contents*, not just metadata.
2. **Cross-encoder reranking** — actually wire the already-configured-but-unused reranker into the query path.
3. **Per-index embedder pluggability** — architectural seam so future cloud providers (Vertex, Gemini, OpenAI) can be added without touching plugin code. Local Termite-only at ship time.
4. **Aggregations parameter plumbing** — pipe an `aggregations` field through `SearchAPI.query()` so future UI consumers (memory rework, Ask page) can ask for date histograms and term buckets without backend changes. **No new UI consumers in this spec.**
5. **Documentation** — refresh `.claude/knowledge/search-system.md`, write a new `.claude/knowledge/multimodal-search.md`, update README, and open a detailed follow-up planning doc for graph indexes.

**Single user, single machine (Mac mini), no SaaS.** Reindex disruption is acceptable; getting the architecture right matters more than zero-downtime migration.

---

## 2. Non-Goals & Deferred Work

- **Retrieval agent / "Ask Bakin" feature.** Tracked in [#70](https://github.com/markhayden/bakin/issues/70). Depends on this spec landing first. The `bakin_exec_search_ask` MCP tool, the `/api/search/ask` route, the `/ask` UI page, and any synthesis-layer wiring all live there. Agents don't need this for "find things" — they already have six search MCP tools that gain multimodal results automatically when this spec ships.
- **Aggregation UI consumers** (memory page sparkline, assets browser breakdown). The backend parameter ships here; the UI lands with the memory rework so it can be designed coherently with the rest of that page.
- **Graph indexes / relationship extraction.** Big enough to warrant its own spec. We will write a planning doc at `.claude/specs/antfly-graph-indexes.md` as part of *this* work — value, schema sketch, query patterns, rollout — but implement none of it.
- **Cloud embedder providers** (Vertex, Gemini, OpenAI). We design configuration and provider-selection plumbing for them, but only ship local Termite providers.
- **Vision-summarized PDFs** (LLaVA describing each page). Text extraction via `{{remotePDF}}` is the v1 strategy. The schema and templates are structured so a vision-summary index can be added as a sibling later without breaking existing data.
- **Audio/video transcription.** Antfly does not ship Whisper today; revisit when it does.
- **ForeignSource joins** to external databases. Bakin has no external DBs to join against.

---

## 3. Architecture

### 3.1 Asset file server (so Antfly can fetch local files)

Antfly's multimodal helpers (`{{remoteMedia}}`, `{{remotePDF}}`) fetch content over HTTP. Bakin assets live at `~/.bakin/assets/...`. We add a small **internal** read-only file endpoint:

- **Route:** `GET /api/internal/assets/raw/{path}` (catch-all)
- **Listener:** a *separate* HTTP listener bound to `127.0.0.1` only, on a stable port persisted to `~/.bakin/settings.json` (default 3738, configurable). Never exposed via Tailscale.
- **Auth:** an internal shared token (`internalToken`, generated on first boot, persisted to settings). Antfly receives the token via custom headers if its fetcher supports them; otherwise via a short-lived HMAC-signed query param (`?t=<hmac>&exp=<unix>`). Mechanism decided in commit 1 after verifying Antfly's fetcher capabilities.
- **Scoping:** the route resolves paths under `getContentDir()/assets/` only; rejects `..`, symlinks escaping the root, and non-existent files.
- **Why a separate listener:** Bakin's main HTTP server binds to all interfaces (Tailscale-reachable). Multimodal indexing must never leak local file contents over the wire, so the file server gets its own loopback-only socket rather than a route guard on the main server.

URLs passed into Antfly templates look like:
`http://127.0.0.1:{internalPort}/api/internal/assets/raw/{type}/{taskId}/{filename}?t=...`

This is the cleanest of the three options considered (vs. `file://` which is security-restricted in Antfly, vs. base64 data URIs which bloat indexing payloads).

### 3.2 Embedding strategy — two indexes per assets table

Antfly supports **multiple indexes per table**, each with its own embedder, embedding template, and vector space. We exploit this to avoid forcing one model to do everything well:

| Index name | Embedder | Template | What it captures |
|---|---|---|---|
| `assets_text` | `bge-small-en-v1.5` (Termite, 384-dim) | `{{description}} {{tags}} {{file_name}} {{#if pdf_url}}{{remotePDF url=pdf_url}}{{/if}}` | Sidecar metadata + extracted PDF text |
| `assets_visual` | `clip-vit-base-patch32` (Termite, 512-dim) | `{{#if image_url}}{{remoteMedia url=image_url}}{{/if}}` | Image content via CLIP joint text-image space |

The asset document gains two computed fields, populated at index time only (not stored on disk):
- `pdf_url` — set when extension is `.pdf`
- `image_url` — set when `asset_type === 'images'`

Both URLs point at the internal file server (§3.1). For non-PDF/non-image assets, both fields are empty and only the sidecar metadata gets embedded into `assets_text`.

**Query fan-out:** asset queries hit *both* indexes via Antfly's `indexes` array; RRF merges ranks. Pure text queries naturally favor `assets_text`; visual queries (e.g., "diagram with arrows") favor `assets_visual` because CLIP aligns text and image embeddings.

**Other tables (tasks, projects, audit, etc.)** stay on a single text index. We **upgrade their embedder** from `all-MiniLM-L6-v2` → `bge-small-en-v1.5` (better quality, same dimensionality, free, local) since we are reindexing everything anyway. One config change in `settings.json` plus a one-shot reindex on next boot.

### 3.3 Embedder configuration — provider-pluggable

Today `settings.antfly.embedder` is a single global `{ provider, model }`. We restructure to support per-index overrides while keeping the existing field for backward compat (read but log a deprecation warning if present, migrate it to `embedders.default` automatically):

```ts
embedders: {
  default: { provider: 'termite', model: 'bge-small-en-v1.5' },
  visual:  { provider: 'termite', model: 'clip-vit-base-patch32' },
  // future: { provider: 'vertex', model: 'multimodalembedding@001', credentials: '...' }
}
```

Content type registrations may now declare a per-index `embedderRef: 'default' | 'visual' | <custom>`. The registry resolves the ref at table-creation time. Adding a new provider means adding a case in `antfly.ts#resolveEmbedder()` plus a settings entry — no plugin code changes.

### 3.4 Cross-encoder reranker — wired for real

The reranker config (`settings.antfly.search.reranker`) currently exists in `packages/core/src/settings.ts` but is **not** referenced anywhere in `src/core/antfly.ts`. We will:

1. Pass `reranker` through to `QueryRequest.reranker` in the query builder.
2. Default to `{ provider: 'termite', model: 'mxbai-rerank-base-v1', threshold: 0.0 }` when search is enabled.
3. Make it disable-able per query — facet aggregations and ID lookups should skip it for latency.
4. Expose a `rerank?: boolean` flag on `SearchAPI.query()` params, default `true`.

### 3.5 Aggregations parameter plumbing

Add an `aggregations` field to `SearchQueryParams` that maps directly through to Antfly's `QueryRequest.aggregations`. Plumb it through `src/core/search-registry.ts` and `src/core/antfly.ts`. **No plugin or UI consumer in this spec** — the field exists, accepts a request, returns results, has tests, and is documented. Future consumers (memory rework, Ask page) can use it without backend changes.

---

## 4. Acceptance Criteria

1. **Search by file content works.**
   - Index a PDF containing the unique phrase "Wyoming LLC operating agreement." Query for `wyoming llc` via `bakin_exec_search_query` and the asset appears in the top 3 results.
   - Index a PNG diagram of a kafka pipeline. Query for `kafka pipeline diagram` and the asset appears in the top 5 results.
2. **Reranker is observably wired.**
   - With `search.reranker.enabled = true`, query responses include per-hit reranker scores, and result ordering for an ambiguous query measurably differs from the same query with `rerank: false`.
3. **Asset file server is locked down.**
   - Requests to `/api/internal/assets/raw/...` from a non-loopback interface (Tailscale) are refused.
   - Requests without a valid token return 401.
   - Requests for paths containing `..` or symlinks escaping the assets root return 404.
4. **Embedder is per-index.**
   - `bakin_assets` table has two indexes (`assets_text`, `assets_visual`) with different embedders, verifiable via `client.indexes.list()`.
5. **Other tables migrated cleanly.**
   - All non-asset tables use `bge-small-en-v1.5`. Pre-existing search tests still pass after the embedder swap.
6. **Reindex pipeline handles the new schema.**
   - `pnpm cli reindex assets` from a cold state populates both indexes with no errors and produces non-zero embedding counts in `client.tables.get('bakin_assets')`.
7. **Aggregations plumb through.**
   - A unit test sends a `SearchAPI.query()` call with an `aggregations` field, verifies it reaches Antfly as `QueryRequest.aggregations`, and verifies the response is mapped back to the caller. No UI consumer required.
8. **Tests pass.**
   - All existing tests in `tests/core/search-*` and `tests/plugins/assets/*` still pass.
   - New tests cover: file-server auth/scoping, embedder resolver, reranker integration, multimodal indexing path, aggregations passthrough.
9. **Docs updated.**
   - `.claude/knowledge/search-system.md` reflects the new embedder structure, multi-index assets, and reranker.
   - New `.claude/knowledge/multimodal-search.md` covers the URL-fetching architecture, security model, and how to add new modalities.
   - `README.md` "Search" section mentions multimodal capabilities.
   - `.claude/specs/antfly-graph-indexes.md` exists as the deferred-work plan.
   - PR description references issue #70.
10. **No production data leakage.**
    - All new tests mock `getContentDir()`, `logger`, `watcher`, and `openclaw-client` per `CLAUDE.md` testing rules.

---

## 5. Project Structure (files we'll touch or add)

### Add
```
src/core/
  antfly-internal-server.ts      — Loopback-only file server for Antfly fetches
  antfly-internal-token.ts       — Token generation, persistence, HMAC signing
  embedder-resolver.ts           — Resolves embedderRef → concrete provider config
.claude/knowledge/
  multimodal-search.md           — New: architecture, security, how-to-extend
.claude/specs/
  antfly-graph-indexes.md        — Deferred-work plan for graph indexes
tests/core/
  antfly-internal-server.test.ts — Auth, scoping, traversal protection
  antfly-internal-token.test.ts  — Round-trip, expiry, tampering
  embedder-resolver.test.ts      — Per-index embedder resolution
  antfly-reranker.test.ts        — Reranker wiring and per-query disable
  antfly-aggregations.test.ts    — Aggregations passthrough
tests/plugins/assets/
  multimodal-indexing.test.ts    — Full path: sidecar → URL → mocked Antfly call
```

### Modify
```
packages/core/src/settings.ts          — embedders map, internal token + port, reranker defaults
packages/core/src/plugin-types.ts      — SearchContentTypeDefinition.indexes[] with embedderRef; SearchQueryParams.aggregations
src/core/antfly.ts                     — Multi-index support, reranker wiring, embedder resolver hookup, aggregations passthrough
src/core/search-registry.ts            — Plumb indexes[] and aggregations through table creation and queries
server.ts                              — Boot the loopback file server alongside main server
plugins/assets/index.ts                — Two-index registration, pdf_url/image_url computed fields
plugins/assets/lib/asset-index.ts      — Compute pdf_url/image_url and pass through to search doc
.claude/knowledge/search-system.md     — Update for new architecture
README.md                              — Mention multimodal in search highlights
```

---

## 6. Commands

Standard development commands; nothing new in core dev workflow:

- `pnpm dev` — start Bakin in dev mode (boots the new internal file server too)
- `pnpm dev:mock` — same with Imitation Crab (mock OpenClaw)
- `pnpm test` — vitest, all suites
- `pnpm test tests/core/antfly-internal-server.test.ts` — single file
- `pnpm cli reindex assets` — full reindex of the assets table (verify multimodal pipeline)
- `pnpm cli reindex --all` — full reindex after switching the default embedder (one-shot migration)
- `antfly termite pull --variants i8 bge-small-en-v1.5 clip-vit-base-patch32 mxbai-rerank-base-v1` — one-time, run on the host before first multimodal boot

---

## 7. Code Style

Inherits all conventions from `CLAUDE.md`. Specific call-outs:

- **Zod at boundaries.** All new HTTP routes (`/api/internal/assets/raw/*`) validate with Zod.
- **Logger per module.** `const log = createLogger('antfly-internal-server')`, etc.
- **No `any` across module boundaries.** Multimodal templates produce loosely-typed payloads going into Antfly; type the Bakin-side document strictly and let the wire format be `Record<string, unknown>` only at the call site.
- **Functional preference.** Embedder resolver, token signer, URL builder are all pure functions.
- **Path resolution.** All filesystem paths go through `getContentDir()` / `getBakinPaths()`. The internal file server **must** call `path.resolve()` and verify the result is under the assets root before reading.
- **Comments.** Default to none. The token signing helper gets one short comment explaining *why* HMAC + expiry (limit replay window). The `pdf_url`/`image_url` fields get one comment explaining they are computed at index time, not stored on disk.

---

## 8. Testing Strategy

### Unit (vitest, mocked Antfly + filesystem)
- **Embedder resolver:** returns correct provider config for default/visual/custom refs; throws on unknown ref.
- **Token signer:** round-trips a valid token; rejects expired tokens; rejects tampered tokens.
- **Internal file server:** serves a valid request, rejects 401, rejects 404 for traversal, rejects non-loopback (mocked req).
- **Reranker wiring:** `query()` builds a `QueryRequest` with `reranker` populated when settings enable it; omits when `rerank: false` is passed.
- **Multi-index registration:** a content type with two indexes produces two `client.indexes.create()` calls with the right embedders.
- **Multimodal indexing:** indexing a PDF asset produces a search doc with `pdf_url` set; an image asset produces a search doc with `image_url` set; a `.txt` asset produces neither.
- **Aggregations passthrough:** a query with `aggregations` field reaches Antfly with the field intact and the response is mapped back.

### Integration (real Antfly, gated)
A new test file `tests/integration/multimodal.test.ts` runs only when `BAKIN_TEST_ANTFLY_URL` is set. Spins up the internal file server, indexes a fixture PDF and PNG, queries by content, asserts both come back. **Skipped in normal CI**, run manually before merge.

### Manual smoke (run by Mark before merge)
1. `pnpm cli reindex --all` after switching embedders — verify zero errors in logs.
2. Drop a fixture PDF into `~/.bakin/assets/other/test/wyoming.pdf` with sidecar — verify it appears in search for a content phrase.
3. Drop a fixture PNG diagram — verify visual search hit.
4. Confirm the Tailscale host cannot reach `http://<mac-mini>:{internalPort}/api/internal/assets/raw/...`.

### Mandatory test hygiene (per `CLAUDE.md`)
Every new test file mocks: `src/core/content-dir`, `src/core/logger`, `src/core/watcher`, `src/core/openclaw-client`. No exceptions.

---

## 9. Boundaries

### Always do
- Honor the OpenClaw Adapter Principle. Nothing here writes OpenClaw state — assets and search are Bakin-owned.
- Use `getContentDir()` / `getBakinPaths()` for every filesystem path.
- Bind the internal file server to `127.0.0.1` only, on a port persisted to `~/.bakin/settings.json`.
- Reuse Antfly's `multiquery` for the assets text+visual fan-out so it's a single round trip.
- Update tests and docs in the same commits that change behavior.

### Ask first
- Anything that requires pulling new Termite models. Mark needs to confirm disk space and run `antfly termite pull` on the host before the embedder switch lands.
- Schema migrations that drop existing tables. The spec assumes a clean drop+recreate is acceptable for `bakin_assets` and the embedder swap. Reconfirm before deleting any other table.
- Adding any new dependency to `package.json`. Multimodal should not need any — Antfly does the heavy lifting.
- Touching CI configs.

### Never do
- Bind any new HTTP listener to a non-loopback interface.
- Send asset bytes to any external service. All multimodal work is local-only via Termite.
- Embed user data in URLs that are logged at info level (signed-token query params go to debug-level logs only).
- Skip the `getContentDir()` mock in any test that touches the filesystem.
- Implement graph indexes in this spec — write the planning doc only.
- Implement any retrieval-agent or Ask functionality in this spec — that's #70.
- Use `--no-verify`, force-push, or amend pushed commits.

---

## 10. Commit & Branch Strategy

**Branch:** `feat/multimodal-search`, branched from `main`. Created at the start of `/agent-skills:build`.

**Commits — one per vertical slice, in order:**

1. `feat(search): add loopback-only internal file server with token auth`
2. `feat(search): add per-index embedder resolver and config schema`
3. `feat(search): support multiple indexes per content type in registry and antfly client`
4. `feat(search): wire cross-encoder reranker into query pipeline`
5. `feat(search): plumb aggregations parameter through SearchAPI.query`
6. `feat(assets): index PDF text and image content via multimodal embedding template`
7. `chore(search): switch default embedder to bge-small-en-v1.5 and bump search schema version`
8. `docs(search): rewrite knowledge/search-system.md, add knowledge/multimodal-search.md, update README`
9. `docs(graph): add deferred-work spec for antfly graph indexes`

Each commit is independently buildable; tests for each slice land in the same commit. PR opens after commit 9, references issue #70 in the description, and includes a checklist mirroring §4 acceptance criteria.

---

## 11. Open Questions (resolve during build)

1. **Antfly fetcher headers.** Does Antfly's URL fetcher support custom HTTP headers? If yes → bearer token. If no → fall back to signed query param. **Action:** check Antfly fetcher source in commit 1.
2. **CLIP query path.** Does Termite's `clip-vit-base-patch32` accept text queries (joint embedding) or images only? If images-only, visual queries need a separate text-encoding path. **Action:** verify in Termite docs in commit 6.
3. **Internal port stability.** Stable in settings vs. random per boot? Probably stable so URLs in the index don't go stale across restarts. **Action:** confirm in commit 1.

---

## 12. Lifecycle

```
spec-driven-development (this doc)
  → planning-and-task-breakdown   (/agent-skills:plan)
    → incremental-implementation  (/agent-skills:build)
      → test-driven-development   (/agent-skills:test)
        → code-review-and-quality (/agent-skills:review)
          → git-workflow          (PR + merge to main)
            → follow-up           (#70 picks up Ask Bakin once this lands)
```
