# TODO — Assets plugin URL state (Phase 2, PR 4)

Branch: `feat/assets-url-state` (create AFTER #840 merges). Plan: `tasks/assets-url-state/plan.md`.

## Task 1 — `?version=` (commit `feat(assets): previewed version rides ?version=`)
- [x] `useQueryState('version', '')` from `@makinbakin/sdk/navigation`; `selectedVersion` parsed from it; row select writes `''` for the current version, `String(n)` otherwise
- [x] Existing `versioned-asset-detail.test.tsx` mock gains a state-backed `useQueryState`
- [x] NEW `versioned-asset-detail-url-state.test.tsx` (shim + spy navigate + `useParams` override): cold-load v1, select v1 → replace nav, select current → param dropped, stale → current
- [x] Focused tests (7/0 across 2 files), lint (0 errors), typecheck, `ui:conformance --quick` (228/0); full suite — see commit
- [x] **Checkpoint A** → commit 1

## Task 2 — docs (commit `docs(assets): ?version= preview semantics`)
- [x] `assets-versioning.md` URL note
- [x] `url-state-deep-linking.md`: Assets row (drop stale `asset`, add `version`) + `version` param row
- [x] Spec: status + row 6 implemented
- [x] `docs:validate` (49 pages) → commit 2

## Checkpoint C — merge-ready
- [x] `check:cycles` (12 pinned, 0 new); `ui:conformance --full` result posted on the PR; clean tree
- [x] `gh pr create` with live checklist; NOT merged; CI watched
