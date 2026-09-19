# PLAN — Brands plugin URL state (Phase 2, PR 5)

Branch `feat/brands-url-state` from `main` after the previous Phase 2 PR merges (shared docs files). Two commits.

## Overview

`/brands/$brandId/docs/$kind/$name` is a routed markdown editor whose Edit/Preview toggle lives in `useState`
(`brand-doc-editor.tsx:56`, control at `:218-228`). Mirror the team shared-context editor (#830): `?mode=preview`.

| Surface | Today | After |
|---|---|---|
| Doc editor Edit/Preview | `useState<MarkdownEditorMode>('edit')` | `?mode=` (default `edit`, omitted) — only `?mode=preview` appears |

## Architecture decisions

- Identical shape to `team-detail.tsx` (#830): `const [modeParam, setModeParam] = useQueryState('mode', 'edit')`,
  `mode = modeParam === 'preview' ? 'preview' : 'edit'`, control writes `setModeParam(value)`; replace-mode.
- The editor's `useUnsavedChangesGuard` ignores same-pathname navigations, so a mode toggle while dirty never prompts.
- `useQueryState` from `@makinbakin/sdk/navigation` (file already imports from there). The existing
  `brand-doc-editor.test.tsx` mocks `@/hooks/use-query-state` (state-backed) — and `brand-detail.tsx` already reads
  `tab`/`draftTask` through that path in the same test — so the editor's new read must go through a mocked path
  too: mock `@makinbakin/sdk/navigation`'s `useQueryState`? No — that file's tanstack mock has `useLocation` with
  `search: routeSearch`, so the REAL `useQueryState` over that mock reads `routeSearch`. Seed `routeSearch.mode` in the
  new cases; `navigateMock` records writes.
- No UI change.

## Task list

### Task 1: `?mode=` (commit 1)

**Acceptance criteria:**
- [ ] `?mode=preview` cold-loads the editor in preview ("Preview" tab selected, preview surface rendered, no textbox); default is edit with a clean URL.
- [ ] Choosing Preview emits one replace navigation with `mode=preview`; choosing Edit from preview emits one with `mode` absent; with unsaved edits, no unsaved-changes dialog appears on the toggle.

**Verification:** `bun test tests/plugins/brands/brand-doc-editor.test.tsx --isolate` (cases added there — its private router mock is already seedable); lint, typecheck, `ui:conformance --quick`; full `bun run test`.

**Files:** `plugins/brands/components/brand-doc-editor.tsx`, `tests/plugins/brands/brand-doc-editor.test.tsx`. **Scope:** XS.

**Commit:** `feat(brands): doc editor mode rides ?mode=`

### Task 2: docs + spec (commit 2)

- [ ] `brands-plugin.md`: URL note for the doc editor.
- [ ] `url-state-deep-linking.md`: Brands row (`q` list, `tab` detail, `mode` doc editor).
- [ ] Spec: status; row 7 implemented. `docs:validate`.

**Commit:** `docs(brands): ?mode= doc editor semantics`

## Checkpoints / risks

Same as the team PR. Risk: the brainstorm panel or SaveBar re-renders on search changes — none expected (search is
read once per render).
