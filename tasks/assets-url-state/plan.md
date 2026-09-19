# PLAN — Assets plugin URL state (Phase 2, PR 4 of `.claude/specs/settings-url-state.md`)

Branch `feat/assets-url-state` from `main` AFTER #840 (workflows) merges (shared docs files). Two commits.

## Overview

`/assets/$assetId` previews one version of the asset; the selected version lives in `useState`
(`VersionedAssetDetail.tsx:59`), so "look at v3 of this logo" is not a link and does not survive refresh. Move it to
`?version=<n>` under the Phase 2 rules (in-page selection ⇒ replace; stale ⇒ default without rewrite).

| Surface | Today | After |
|---|---|---|
| Previewed version on `/assets/$assetId` | `selectedVersion` local; unknown → current | `?version=<n>`; the current version is the default and omitted; unknown/stale `n` → current, URL untouched |

## Architecture decisions

- **Default = the manifest's `currentVersion`, encoded as "param absent."** Selecting the current version writes `''`
  (drops the param); selecting any other writes `String(n)`. The existing `previewVersion` derivation already
  falls back to `currentVersion` for ids not in `manifest.versions`, which IS rule 4 — keep it, feed it from the URL.
- **Replace-mode** (in-page selection, not an overlay). Promote/delete flows are untouched; after a promote the new
  current becomes the default and a pinned `?version=` keeps pointing at the (still existing) old version — honest.
- **`useQueryState` from `@makinbakin/sdk/navigation`** (the file already imports `useParams` from there).
- **Tests:** the existing `versioned-asset-detail.test.tsx` mocks `@makinbakin/sdk/navigation` wholesale, so it gains
  a `useState`-backed `useQueryState` in that mock (models-page precedent). NEW `versioned-asset-detail-url-state.test.tsx`
  runs the real navigation hooks over the router shim with a stable spy navigate and a `useParams` override supplying
  `assetId` (the shim's returns `{}`).
- **No UI change.**

## Task list

### Task 1: `?version=` selects the previewed version (commit 1)

**Acceptance criteria:**
- [ ] `/assets/<id>?version=1` cold-loads previewing v1 (badge "v1 · selected"), zero navigations.
- [ ] Clicking the v1 row emits ONE replace navigation with `version=1`; clicking the current (v2) row emits ONE replace navigation with `version` absent.
- [ ] `?version=9` (not in the manifest) previews the current version, zero navigations.
- [ ] Existing `versioned-asset-detail.test.tsx` green with the extended mock.

**Verification:** `bun test tests/plugins/assets/versioned-asset-detail-url-state.test.tsx tests/plugins/assets/versioned-asset-detail.test.tsx --isolate`; lint, typecheck, `ui:conformance --quick`; full `bun run test`.

**Files:** `plugins/assets/components/versioned/VersionedAssetDetail.tsx`, `tests/plugins/assets/versioned-asset-detail-url-state.test.tsx` (NEW), `tests/plugins/assets/versioned-asset-detail.test.tsx`. **Scope:** S.

**Commit:** `feat(assets): previewed version rides ?version=`

### Task 2: docs + spec (commit 2)

- [ ] `.claude/knowledge/assets-versioning.md`: URL note (`/assets/$assetId?version=`; current = default omitted; stale → current).
- [ ] `.claude/knowledge/url-state-deep-linking.md`: Assets row — drop the stale `asset` param (detail is path-based `/assets/$assetId`), add `version`; `version` param row.
- [ ] Spec: status (PR 3 shipped once merged; PR 4 here); row 6 implemented.
- [ ] `bun run docs:validate`.

**Commit:** `docs(assets): ?version= preview semantics`

## Checkpoints

- **A (after T1):** focused + full suite, lint, typecheck, `ui:conformance --quick`; commit 1.
- **C (merge-ready):** `check:cycles`, `ui:conformance --full` (Docker → CI), clean tree, `gh pr create`; NOT merged.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Existing detail test's wholesale navigation mock lacks `useQueryState` → component crashes under it | Med | Extend the mock in T1 (state-backed, key-agnostic is enough: the page reads one key) |
| The detail page's `useParams` over the shim returns `{}` | Med — fetch URL breaks in the new test | Override `useParams` in the per-file tanstack mock |
| Promote changes `currentVersion` while `?version=` pins the old one | Low — preview stays on the pinned version, badge says "selected" | Documented; no auto-clear (the pinned version still exists) |
