---
title: "Image reference/context images + media-shim parity"
status: draft
issues: [380, 379, 418]
supersedes_notes: "Closes the three 'Known limitations' deferred from the retired media-generation-adapter-architecture spec."
---

# Image reference/context images + media-shim parity

## 1. Objective

Make Bakin's image generation materially better by letting agents condition
generation/edit on **reference images**, and close two latent correctness gaps
in the media-generation path discovered during the adapter review.

Single user, single machine (Mac mini + OpenClaw). **No backwards-compat /
shims for old data** — clean, truthful, single-source-of-truth code is the
priority. Three GitHub issues, one PR, three checkpointed commits.

Target "user": an AI agent calling the images MCP tools
(`bakin_exec_images_generate` / `_edit`), and the human reading the resulting
asset in the dashboard.

### Ground truth established from the real OpenClaw CLI (`openclaw/openclaw`)

Verified against `src/cli/capability-cli.ts` + `docs/cli/infer.md` (open source):

- `infer image generate` flags: `--prompt --model --count --size --aspect-ratio
  --resolution --output-format --background --openai-background --timeout-ms
  --output --json`. **No `--file`. No `--quality`.**
- `infer image edit` is identical **plus a required, repeatable `--file`**
  (collects an array). This is the only generate-style command that takes input
  images.
- Therefore: **reference-image generation is impossible on `generate`** and must
  route through the `edit` command; **`quality` does not exist** in OpenClaw and
  can only mean anything on the direct-HTTP shim.

## 2. Scope: three issues, one PR

| Commit | Issue | Summary |
| --- | --- | --- |
| 1 | #380 | Single source of truth for image mime↔ext + provider→env-var, consumed by shim **and** images plugin. |
| 2 | #379 | (a) Shim hard-fails on options it can't honor; (b) `quality` recorded only when actually applied (shim path). |
| 3 | #418 | Reference/context images in generate + extra references in edit, with lineage + idempotency + capability gating + UI. |

Dependency order: #380 (foundation) → #379 (forwarding discipline) →
#418 (feature on top).

---

## 3. Feature detail + acceptance criteria

### Commit 1 — #380: shared mime/ext + provider→env-var tables

**Problem.** `direct-image-provider.ts` (core) re-encodes a mime→ext table
(`extForMime`) and provider→env-var names (`resolveDirectImageKey`) that the
images plugin also owns (`IMAGE_PROVIDERS[].envVars`, `bakin-plugin.json`
`secrets`, and `plugins/assets/lib/constants.ts` mime map). Core must not import
plugin code, so the tables drift independently.

**Design.** New `packages/core/src/media/image-format.ts` is the single source of
truth for:
- image **mime ↔ extension** (png/jpeg/webp/gif): `extensionForImageMime(mime)`
  + the reverse map.
- **provider → env-var names**: `IMAGE_PROVIDER_ENV_VARS` table +
  `resolveDirectImageKey` reads from it.

Consumers import from core:
- `direct-image-provider.ts` — `extForMime` → `extensionForImageMime`;
  `resolveDirectImageKey` uses the shared env-var table.
- `plugins/images/lib/providers.ts` — `IMAGE_PROVIDERS[].envVars` derives from the
  shared table (no hand-typed env names).
- `plugins/assets/lib/constants.ts` — its **image rows** of `EXTENSION_TO_MIME`
  compose the core image map (assets keeps audio/video/doc rows + asset-type
  classification, which are not media-gen concerns).
- `plugins/images/bakin-plugin.json` `secrets` — validated against the shared
  table by a test (drift guard), not hand-synced.

**Acceptance.**
- One image mime/ext mapping and one provider→env-var table in core.
- Adding a provider/format/env-var is a one-place edit.
- A test asserts `bakin-plugin.json` `secrets` ⊆ the shared env-var table.

### Commit 2 — #379: shim guardrail + truthful quality

**(a) Shim hard-fails on unsupported options.**
`DirectImageRequest` gains the full option surface the native path carries
(`count`, `aspectRatio`, `resolution`, `background`, `outputFormat`).
`generateDirectImage` validates **before** the billed HTTP call and throws a
clear error for anything it can't honor:
- `count` > 1 → throw (single-image endpoints).
- `aspectRatio` / `resolution` / `background` present → throw (not wired).
- `outputFormat` ∉ shim-supported set → throw.

Rationale: image generation is billed + non-idempotent; failing before spend
beats a wrong-but-charged image. **Zero user impact today** — no Bakin code path
passes these options; this is a guardrail that converts a future silent drop
into an immediate clear failure.

**(b) Quality is recorded only when applied.**
OpenClaw has no quality knob; `quality` is honored only by the shim
(`qualityForOpenAI`). Today the asset sidecar records the requested tier even on
native generates that ignored it — a fiction.
- `GenerationSchema.quality`: `z.string()` → `z.string().optional()`.
- `tools.ts persistImageResult`: include `quality` in `generation` **only when
  `routeSource === 'shim'`**; omit on native.
- `versionMatchesRequest` / reuse-match: treat "no recorded quality" as the
  native normal state (don't fail a reuse match because native omitted it).

**Acceptance.**
- Shim throws (pre-billing) on count>1/aspectRatio/resolution/background/bad
  format; tests cover each.
- Native-path generated assets have no `generation.quality`; shim-path ones do.
- Existing manifests with `quality` still parse (optional field).

### Commit 3 — #418: reference/context images

**Tool contract (both `generate` and `edit`).**
New optional `referenceImages: string[]`. Each entry auto-classified:
- matches the assetId validator (`isValidAssetId`) → resolve current version via
  `ctx.assets.resolveVersionFile`.
- else → treat as a file path, `existsSync`-checked, then **auto-imported into
  Assets** (source-path dedup: reuse the existing asset if that path/content is
  already managed, else import once) so it becomes a tracked assetId. A fresh
  Discord attachment thus becomes a navigable asset, not a loose path.
- Unresolvable entry → fail loudly (no silent drop).
- Cap: `MAX_REFERENCE_IMAGES = 4` (style/logo/product workflows); exceeding →
  clear error. Constant lives with the tool, easy to bump.

After resolution, **every reference is a managed `assetId@version`** — there is no
raw-path branch downstream. This uniformity simplifies lineage, idempotency, and
the UI.

**Threading.**
- `RuntimeImageGenerateInput` gains `referenceImages?: string[]` (file paths;
  Bakin resolves assetIds → paths before the adapter call).
- `RuntimeImageEditInput.files` already exists; extra references **append after**
  the base asset's current version (base stays `files[0]`).
- OpenClaw adapter `images.generate`: if `referenceImages` present, route to the
  **`image edit`** command with `file: referenceImages` (generate has no
  `--file`). Otherwise unchanged.
- OpenClaw adapter `images.edit`: `files = [baseCurrentVersion, ...references]`.

**Shim path.** Native-only. If a request carries `referenceImages` and the route
resolves to the shim, **throw before billing**
("reference images require the native runtime; <provider> is served via the
direct shim"). Shim reference support is an explicit future follow-up.

**Capability gating.** Gate on the selected model's `reference-images`
capability flag (from the provider descriptor); if absent, throw a clear error
naming the model **before billing** — finally making the declared flag real.
Runtime-only discovered models lack the flag and are refused until #381 makes
runtime capability discovery trustworthy (documented dependency).

**Lineage (provenance — answers "associate assets with calls in practice").**
`GenerationSchema` gains optional `references` (uniform, since raw paths are
auto-imported):
```ts
references?: Array<{ assetId: string; version: number }>
```
Recorded at `persistImageResult` for both generate and edit. OpenClaw never
knows these are assets; Bakin owns the persist step and stamps the resolved
`assetId@version` identity.

**Idempotency.** `ImageCallKey` + `versionMatchesRequest` fold in a stable
**reference fingerprint** = sorted join of `assetId@version`. Same prompt +
different references ⇒ different key ⇒ not a duplicate; same prompt + same
references ⇒ dedupes as before.

**UI.** Asset detail page renders a **References** row when
`generation.references` is present: every ref is a clickable asset chip
(navigate to that asset). Uses existing `ProvenanceChips`/versioned detail
patterns.

**Asset discovery (Story 3 enabler).** Add an optional `tags: string[]` filter to
the `bakin_exec_assets_list` MCP tool (the list service already supports
tag-aware listing for the UI). Makes "look in our brand-assets folder" a single
clean lookup instead of list-all-and-filter-client-side.

**Acceptance.**
- `generate` + `edit` accept `referenceImages` (assetIds and/or paths, mixed).
- Native generate-with-references routes through `image edit` with the refs as
  `--file`s; edit appends refs after the base.
- Shim + references → loud pre-billing error.
- Model without `reference-images` capability → loud pre-billing error naming the
  model.
- Lineage persisted in `generation.references`; visible + navigable in asset
  detail.
- Idempotency: same prompt/different refs not deduped; same prompt/same refs
  deduped.
- The previously-dead `reference-images` capability is now exercised.

---

## 4. Files touched

**Core**
- `packages/core/src/media/image-format.ts` (new) — mime/ext + env-var SoT.
- `packages/core/src/media/direct-image-provider.ts` — import shared tables;
  add option guardrail; (no reference support — rejects via plugin layer).
- `packages/core/src/adapters/runtime/concepts.ts` — `referenceImages?` on
  `RuntimeImageGenerateInput`.
- `packages/core/src/media/index.ts` — export new module (verify barrel).

**Adapter**
- `packages/adapter-openclaw/src/runtime.ts` — generate routes to `edit` when
  references present; edit appends references; (no quality flag — confirmed
  absent).

**Plugins**
- `plugins/assets/lib/manifest.ts` — `quality` optional; add `references` to
  `GenerationSchema`.
- `plugins/assets/lib/constants.ts` — image mime rows compose core map.
- `plugins/assets/components/versioned/*` — References row on detail page.
- `plugins/images/index.ts` — `referenceImages` in `generateShape`/`editShape`;
  tool descriptions clarify edit (= new version of same asset) vs generate-with-
  references (= new sibling asset) so agents pick the right one.
- `plugins/images/lib/tools.ts` — resolve/classify/cap references (auto-import
  raw paths via source-path dedup); thread to runtime; record lineage;
  quality-only-when-applied; reference fingerprint in idempotency + reuse-match.
- `plugins/images/lib/providers.ts` — env-vars from shared table; capability gate
  helper.
- `plugins/images/bakin-plugin.json` — (unchanged values; covered by drift test).
- `plugins/assets/index.ts` — optional `tags: string[]` filter on
  `bakin_exec_assets_list`.

**Docs**
- `.claude/knowledge/media-generation-adapter-architecture.md` — shared tables,
  shim guardrail, quality-shim-only, references-native-only.
- `.claude/knowledge/images-plugin.md` — reference images, capability gate,
  quality semantics.
- `.claude/knowledge/assets-versioning.md` — `generation.references`, quality
  optional, References UI.
- README.md — verified: no image-generation section; **no change**.

## 5. Code style / constraints

- TypeScript strict; no `any` across module boundaries.
- Zod at boundaries (tool inputs, manifest).
- Adapter boundary intact: plugins never import provider HTTP; references
  resolved at the Bakin layer, paths handed to the runtime capability.
- No fabricated CLI flags, no fabricated model metadata.
- `const` over `let`; kebab-case files; functional preference.
- No silent drops anywhere — every unsupported request fails loudly **before
  billing**.

## 6. Testing strategy (TDD per commit)

All tests mock content-dir (both facades) + OpenClaw home per CLAUDE.md.

- **#380** `tests/plugins/images/providers.test.ts` (+ a small core media test):
  env-vars come from shared table; `bakin-plugin.json` secrets ⊆ table.
- **#379** `tests/core/media/direct-image-provider.test.ts`: each unsupported
  option throws before any fetch. `tests/plugins/images/tools.test.ts`: native
  result omits `generation.quality`; shim result includes it; reuse-match works
  across the asymmetry.
- **#418** `tests/adapter-openclaw/runtime-images.test.ts`: generate-with-refs
  invokes `image edit` with `--file`s; edit appends refs after base; no
  `--quality` ever emitted. `tests/plugins/images/tools.test.ts`: assetId + path
  resolution, cap enforcement, capability-gate rejection, shim+refs rejection,
  lineage recorded. `tests/plugins/images/idempotency*.test.ts`: reference
  fingerprint changes the key; identical refs dedupe.

## 7. Boundaries

**Always:** fail loudly before billing; single source of truth; truthful
sidecars; keep the adapter boundary clean; update `.claude/knowledge` docs for
every change.

**Ask first:** any change that would touch the search schema
(`SCHEMA_VERSION` bump) — current plan deliberately avoids it
(references/quality are not search fields). Any expansion to shim reference
support or full shim option implementation.

**Never:** guess OpenClaw flags or model ids; add backwards-compat shims for old
manifests; silently drop a requested option; record metadata a generation didn't
actually apply; let core import plugin code.

## 8. Out of scope (documented, not done here)

- #381 (image model catalog drift) — referenced as the trust dependency for
  runtime-discovered capability flags. Gating uses static descriptors, which are
  correct today.
- Shim reference-image support (direct OpenAI edits / Gemini inlineData).
- Full shim implementation of count/aspectRatio/background/outputFormat.

## 9. Commit strategy (rollback checkpoints)

1. `refactor(media): single source of truth for image mime/ext + provider env vars (#380)`
2. `fix(media): shim rejects unsupported options + record quality only when applied (#379)`
3. `feat(images): reference/context images in generate and edit (#418)`
   — may split into 3a (interface+adapter+tools), 3b (lineage+idempotency),
   3c (asset-detail References UI) if 3 grows large.

Each commit builds, type-checks, and passes its tests independently — every
commit is a clean rollback point.
