---
title: "Implementation plan — image references + shim parity"
spec: ./image-references-and-shim-parity.md
issues: [380, 379, 418]
status: ready-for-review
---

# Plan — image references + media-shim parity

Companion to `image-references-and-shim-parity.md`. One PR, three checkpointed
commits in dependency order. Each commit builds, type-checks, and passes its
tests independently — every checkpoint is a clean rollback point.

## Dependency graph

```
COMMIT 1 (#380 foundation)
  T1.1 core media-format module ──┬─→ T1.2 shim imports it
                                  ├─→ T1.3 images providers env-vars from it
                                  ├─→ T1.4 assets constants compose image rows
                                  └─→ T1.5 tests (table + secrets drift)
            │
            ▼ checkpoint A → commit 1
COMMIT 2 (#379 parity)
  T2.1 shim option guardrail (throws pre-billing)        [edits shim again → after T1.2]
  T2.2 GenerationSchema.quality → optional ──→ T2.3 quality recorded only on shim
                                                  └─→ T2.4 tests
            │
            ▼ checkpoint B → commit 2
COMMIT 3 (#418 feature)
  T3.1 interfaces (RuntimeImageGenerateInput.referenceImages, generation.references, client types)
        ├─→ T3.2 adapter: generate→edit routing + edit appends refs
        └─→ T3.3 plugin tools: resolve/auto-import/cap/gate/shim-reject/lineage/idempotency
                   (depends on T2.3 — same persist fn; and T3.1)
  T3.4 assets_list tags filter            [independent — can land any time in commit 3]
  T3.5 References UI row                   [depends on T3.1 client types]
  T3.6 tests (tools, idempotency, adapter routing, tags filter)
            │
            ▼ checkpoint C → commit 3  (optional split 3a/3b/3c)
PHASE 4 (docs — not a code commit gate, lands in commit 3 or a 4th doc commit)
  T4.1 knowledge docs ×3   T4.2 README verify (expected no-op)
```

Vertical-slice principle: each task carries one complete path (data → logic →
test), not a horizontal layer. T3.2 and T3.3 are the two halves of the feature
that must both land for references to work end-to-end; T3.6 proves the whole
slice.

---

## COMMIT 1 — #380: single source of truth for image format + provider env

### T1.1 — Core media-format module
- **File:** `packages/core/src/media/image-format.ts` (new); export from
  `packages/core/src/media/index.ts`.
- **Do:** image `mime ↔ extension` map (png/jpeg/webp/gif) +
  `extensionForImageMime(mime): string`; `IMAGE_PROVIDER_ENV_VARS:
  Record<DirectImageProviderId, string[]>` (`openai → [OPENAI_API_KEY]`,
  `google → [GEMINI_API_KEY, GOOGLE_AI_API_KEY]`).
- **Accept:** pure module, no node-only imports beyond types; both maps + helper
  exported and typed.
- **Verify:** `bun test tests/core/media/image-format.test.ts --isolate` (new).

### T1.2 — Shim consumes the shared tables
- **File:** `packages/core/src/media/direct-image-provider.ts`.
- **Do:** delete local `extForMime`; use `extensionForImageMime`. Rewrite
  `resolveDirectImageKey` to read env names from `IMAGE_PROVIDER_ENV_VARS`.
- **Accept:** no behavior change; no duplicated tables remain in the shim.
- **Verify:** `bun test tests/core/media/direct-image-provider.test.ts --isolate`.

### T1.3 — Images providers env-vars from the table
- **File:** `plugins/images/lib/providers.ts`.
- **Do:** `IMAGE_PROVIDERS[].envVars` sourced from `IMAGE_PROVIDER_ENV_VARS`
  (no hand-typed env names).
- **Accept:** `providerReadinessFromEnv` behavior unchanged; env names come from
  one place.
- **Verify:** `bun test tests/plugins/images/providers.test.ts --isolate`.

### T1.4 — Assets constants compose the core image rows
- **File:** `plugins/assets/lib/constants.ts`.
- **Do:** image rows of `EXTENSION_TO_MIME` derive from the core image map
  (audio/video/doc rows + asset-type classification stay local — not media-gen
  concerns). No image-row duplication.
- **Accept:** `getMimeType` returns identical results for all current types.
- **Verify:** existing assets constants/serve tests stay green.

### T1.5 — Drift-guard tests
- **Files:** new `tests/core/media/image-format.test.ts`;
  extend `tests/plugins/images/providers.test.ts`.
- **Do:** assert mime↔ext round-trips; assert `bakin-plugin.json` `secrets` ⊆
  flattened `IMAGE_PROVIDER_ENV_VARS` (the future-rename guard from #380).
- **Accept:** both pass; deliberately breaking a table fails the secrets test.

> **Checkpoint A:** `bun run typecheck` (or `tsc --noEmit` path) + the four
> targeted test files green + `bun run build` smoke. **Commit 1.**

---

## COMMIT 2 — #379: shim guardrail + truthful quality

### T2.1 — Shim hard-fails on unsupported options
- **File:** `packages/core/src/media/direct-image-provider.ts`.
- **Do:** extend `DirectImageRequest` with `count?/aspectRatio?/resolution?/
  background?/outputFormat?`. In `generateDirectImage`, **before any fetch**,
  throw a clear `Error` when: `count` > 1; `aspectRatio`/`resolution`/
  `background` set; `outputFormat` ∉ supported set. Message names the offending
  option + "direct-image shim".
- **Accept:** unsupported option → throw, no network call; supported single-PNG
  path unchanged.
- **Verify:** `tests/core/media/direct-image-provider.test.ts` — one case per
  option asserts throw + that `fetch` was never called (mock fetch).

### T2.2 — Quality field becomes optional
- **File:** `plugins/assets/lib/manifest.ts`.
- **Do:** `GenerationSchema.quality: z.string()` → `.optional()`.
- **Accept:** old manifests with `quality` still parse; new ones may omit it.
- **Verify:** manifest parse test with and without quality.

### T2.3 — Record quality only when applied (shim path)
- **File:** `plugins/images/lib/tools.ts`.
- **Do:** in `persistImageResult`, include `generation.quality` only when
  `routeSource === 'shim'`. Update `versionMatchesRequest` + reuse helpers so a
  native version (no quality) still matches a native re-request (don't compare
  quality when neither side recorded it).
- **Accept:** native generate → asset has no `generation.quality`; shim generate
  → has it; reuse/idempotency intact on both.
- **Verify:** `tests/plugins/images/tools.test.ts` — native-omits / shim-includes
  / reuse-match-native cases.

### T2.4 — Tests (folded into T2.1–T2.3 above)

> **Checkpoint B:** typecheck + `tests/core/media/*` +
> `tests/plugins/images/{tools,idempotency,idempotency-durable}.test.ts` green +
> build smoke. **Commit 2.**

---

## COMMIT 3 — #418: reference/context images

### T3.1 — Interfaces & schema
- **Files:** `packages/core/src/adapters/runtime/concepts.ts`;
  `plugins/assets/lib/manifest.ts`; `plugins/assets/components/versioned/types.ts`.
- **Do:** add `referenceImages?: string[]` to `RuntimeImageGenerateInput`
  (resolved **file paths** by the time the adapter sees them). Add optional
  `references?: Array<{ assetId: string; version: number }>` to
  `GenerationSchema`. Mirror `references` in the client `types.ts` generation
  shape.
- **Accept:** types compile; schema parses with/without references.
- **Verify:** `bun run typecheck`; manifest parse test.

### T3.2 — OpenClaw adapter routing
- **File:** `packages/adapter-openclaw/src/runtime.ts`.
- **Do:** in `images.generate`, when `input.referenceImages?.length`, dispatch to
  the **edit** invocation (`runImageInference('edit', { ...input, files:
  referenceImages })`) since `infer image generate` has no `--file`. In
  `images.edit`, build `files = [base, ...references]` (base stays first). Never
  emit `--quality` (confirmed absent).
- **Accept:** refs present on generate → `infer image edit --file …` args; edit
  with extra refs → multiple `--file` in order.
- **Verify:** `tests/adapter-openclaw/runtime-images.test.ts` — assert the exec
  argv (mocked exec) for both paths; assert no `--quality` ever.

### T3.3 — Plugin tools (resolve, gate, lineage, idempotency)
- **Files:** `plugins/images/index.ts`, `plugins/images/lib/tools.ts`,
  `plugins/images/lib/providers.ts`, `plugins/images/lib/idempotency.ts`.
- **Do:**
  - `referenceImages: z.array(z.string()).optional()` on generate + edit shapes;
    tool descriptions clarify edit (new version) vs reference-generate (new
    sibling).
  - New resolve step: classify each entry (`isValidAssetId` → resolve current
    version; else file path → `existsSync` → **auto-import** via source-path
    dedup → assetId). Cap at `MAX_REFERENCE_IMAGES = 4`, else throw. Unresolvable
    → throw.
  - Capability gate: selected model must declare `reference-images`; else throw
    naming the model (before billing).
  - Shim guard: if references present and route resolves to shim, throw
    ("reference images require the native runtime").
  - Pass resolved paths to `runtime.images.generate/edit`; record
    `generation.references = [{assetId, version}…]` in `persistImageResult`.
  - Idempotency: add `references` fingerprint (sorted `assetId@version` join) to
    `ImageCallKey` + `imageCallSignature` + `versionMatchesRequest`.
- **Accept:** all six behaviors above hold; same-prompt-different-refs not
  deduped; same-prompt-same-refs deduped.
- **Verify:** `tests/plugins/images/{tools,idempotency}.test.ts`.

### T3.4 — `assets_list` tags filter
- **Files:** `plugins/assets/lib/asset-service.ts` (`listAssets` filter gains
  `tags?: string[]`, AND-match against normalized manifest tags);
  `plugins/assets/index.ts` (`bakin_exec_assets_list` param + passthrough).
- **Accept:** `list({ tags: ['brand'] })` returns only assets tagged `brand`;
  no tags → unchanged.
- **Verify:** `tests/plugins/assets/*` list test (add tags case).

### T3.5 — References UI row
- **File:** `plugins/assets/components/versioned/VersionedAssetDetail.tsx`
  (+ `atoms.tsx` if a small `ReferenceChips` atom helps).
- **Do:** when `previewVer.generation?.references?.length`, render a
  **References** row: each ref a clickable chip → `/assets/<refAssetId>` with a
  thumb. Follows existing detail/provenance styling.
- **Accept:** detail page shows navigable reference chips; absent when none.
- **Verify:** manual (`bun run dev:mock`) + a light render assertion if a
  component test harness exists for versioned detail.

### T3.6 — Test sweep (folded into T3.2–T3.5)

> **Checkpoint C:** full `bun run test` + `bun run build` + typecheck green.
> **Commit 3** (split into 3a interfaces+adapter+tools / 3b idempotency+lineage /
> 3c tags+UI only if the diff gets unwieldy).

---

## PHASE 4 — Docs (lands within commit 3 or a trailing `docs:` commit)

### T4.1 — Knowledge docs
- `.claude/knowledge/media-generation-adapter-architecture.md` — shared tables,
  shim option guardrail, quality-shim-only, references-native-only.
- `.claude/knowledge/images-plugin.md` — `referenceImages`, capability gate,
  quality semantics, auto-import-of-raw-refs, `assets_list` tags filter.
- `.claude/knowledge/assets-versioning.md` — `generation.references`, quality
  optional, References UI row.

### T4.2 — README
- Verify no image-generation section exists (confirmed during spec). **Expected
  no change**; note in PR if so.

---

## Commit strategy (rollback checkpoints)

1. `refactor(media): single source of truth for image mime/ext + provider env vars (#380)`
2. `fix(media): shim rejects unsupported options + record quality only when applied (#379)`
3. `feat(images): reference/context images in generate and edit (#418)`
   - (optional) `3a feat(images): thread referenceImages through adapter + tools`
   - (optional) `3b feat(images): reference lineage + idempotency fingerprint`
   - (optional) `3c feat(assets): references UI + assets_list tags filter`
+ optional `docs(images): document references, shim guardrail, quality semantics`

Branch off `main` (e.g. `feat/image-reference-images`). PR after checkpoint C +
docs.

## Risk & rollback notes

- **No search-schema change** (references/quality aren't search fields) → no
  `SCHEMA_VERSION` bump, no reindex. If that changes, STOP and ask (spec
  boundary).
- **Manifest schema is parse-time, not migrated** — optional fields are
  back/forward compatible by construction; old manifests parse unchanged.
- **Auto-import side effect**: a raw-path reference creates/upserts an asset.
  Source-path dedup prevents proliferation; verify in T3.3 tests.
- **Billing safety**: every new failure mode (cap, gate, shim+refs, shim
  options) throws **before** the runtime/provider call. A test for each asserts
  no exec/fetch on rejection.
- Each commit is independently revertible; reverting commit 3 leaves #380/#379
  intact and valid.

---

## Task checklist (todo)

**Commit 1 — #380**
- [ ] T1.1 core `image-format.ts` (mime/ext + env-var table)
- [ ] T1.2 shim imports shared tables
- [ ] T1.3 images providers env-vars from table
- [ ] T1.4 assets constants compose image rows
- [ ] T1.5 drift-guard tests (round-trip + secrets ⊆ table)
- [ ] Checkpoint A → commit 1

**Commit 2 — #379**
- [ ] T2.1 shim hard-fails on unsupported options (pre-billing)
- [ ] T2.2 `GenerationSchema.quality` optional
- [ ] T2.3 record quality only on shim path + reuse-match fix
- [ ] T2.4 tests (per-option throw, native-omits/shim-includes)
- [ ] Checkpoint B → commit 2

**Commit 3 — #418**
- [ ] T3.1 interfaces + schema + client types
- [ ] T3.2 adapter generate→edit routing + edit appends refs
- [ ] T3.3 plugin tools: resolve/auto-import/cap/gate/shim-reject/lineage/idempotency
- [ ] T3.4 `assets_list` tags filter
- [ ] T3.5 References UI row (clickable chips)
- [ ] T3.6 test sweep
- [ ] Checkpoint C → commit 3

**Phase 4 — docs**
- [ ] T4.1 update 3 knowledge docs
- [ ] T4.2 verify README (expected no-op)
- [ ] Final: full `bun run test` + build + typecheck; open PR
