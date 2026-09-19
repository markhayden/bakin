# TODO — Chat plugin URL state (Phase 2, PR 7)

Branch: `feat/chat-url-state`. Plan: `tasks/chat-url-state/plan.md`.

## Task 1 — `?q=` (commit `feat(chat): rail search rides ?q= and survives conversation switches`)
- [x] `useQueryState('q', '')` replaces the local search state
- [x] Rail chat push preserves current search params (`agent`, `q`) via `withFilter`
- [x] `chat-page-routing.test.tsx`: cold-load `?q=`, non-match hides the row, typing writes `q`, push preserves `agent` + `q`
- [x] Prove-It bug found + fixed first: `/chat?agent=<id>` update loop (`useChats` unmemoized filter) — probe case fails on the unchanged code (1046 depth errors), passes after `useMemo` → `fix(chat)` commit
- [x] Focused tests (31/0 across 2 chat files, 0 loop errors), lint (0 errors), typecheck, `ui:conformance --quick` (228/0); full suite — see commit → commit 2

## Task 2 — docs (commit `docs(chat): ?q= rail search`)
- [x] `chat-plugin.md` URL surface; `url-state-deep-linking.md` Chat row; spec row 9; `docs:validate` → commit 2

## Checkpoint C
- [x] `check:cycles` (12 pinned, 0 new); `ui:conformance --full` posted on the PR; clean tree; `gh pr create`; NOT merged; CI watched
