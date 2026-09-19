# PLAN — Chat plugin URL state (Phase 2, PR 7)

Branch `feat/chat-url-state` from `main` after the previous Phase 2 PR merges. Two commits.

## Overview

The chat rail's search box is the only list search in the app not on `useQueryState('q', '')`
(`chat-page.tsx:95`, `SearchInput` at `:193-203`). Every other list surface (tasks, assets, schedule, memory, brands,
workflows) uses `q`. Align it.

| Surface | Today | After |
|---|---|---|
| Chat rail search | `useState('')` | `?q=` (replace-mode, omitted when empty) on `/chat`, `/chat/$chatId`, `/chat/new` |

## Architecture decisions

- `const [search, setSearch] = useQueryState('q', '')` — the page already imports `useQueryState` for `agent`; same
  entrypoint. Rail filtering stays client-side (unchanged `useMemo`).
- Selecting a rail chat pushes `/chat/<id>` today via `router.push` with a bare path — that DROPS `?q=` (and `?agent=`,
  which is already the case). Preserve both: build the push URL from the current search params, the way
  `kanban-board.tsx`'s `openArchivedLog` does (`new URLSearchParams(searchParams)` → `pathname?qs`). Decision: keep the
  filter while moving between conversations — a filtered rail that resets on every click is the worse experience.
- Tests: `chat-page-routing.test.tsx` already runs over the shim with a spy navigate — add cases there.
- No UI change.

## Task list

### Task 1: `?q=` (commit 1)

**Acceptance criteria:**
- [ ] `/chat?q=reddit` cold-loads with the search box populated and the rail filtered; typing writes one replace navigation with `q`; clearing drops it.
- [ ] Selecting a rail chat while `?q=`/`?agent=` are set pushes `/chat/<id>?agent=…&q=…` (filters preserved).
- [ ] Existing routing cases unchanged.

**Verification:** `bun test tests/plugins/chat/chat-page-routing.test.tsx tests/plugins/chat/chat-page.test.tsx --isolate`; lint, typecheck, `ui:conformance --quick`; full `bun run test`.

**Files:** `plugins/chat/components/chat-page.tsx`, `tests/plugins/chat/chat-page-routing.test.tsx`. **Scope:** S.

**Commit:** `feat(chat): rail search rides ?q= and survives conversation switches`

### Task 2: docs + spec (commit 2)

- [ ] `chat-plugin.md` URL surface: `q`; `url-state-deep-linking.md` Chat row.
- [ ] Spec: status; row 9 implemented; Phase 2 complete. `docs:validate`.

**Commit:** `docs(chat): ?q= rail search`

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Preserving `?q=` on conversation push changes `chat-page-routing`'s "pushes /chat/<id>" assertion shape | Low | Update that case to assert path + preserved params |
| `useConversationAttention` / `visibleChatIdFromLocation` parse the pathname only | None | `q` is query state; untouched |
