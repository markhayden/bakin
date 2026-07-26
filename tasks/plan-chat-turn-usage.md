# Plan — Chat Per-Turn Usage Visibility (#733)

**Spec:** `.claude/specs/chat-turn-usage.md` (approved 2026-07-25)
**Branch:** `feat/chat-turn-usage` in the MAIN checkout (test-live-before-merge). Verify HEAD before commits.

## Mockups (target UI)

Chat view — settled turns carry the muted usage footer under the reply body
(left column), the controls gutter (time/copy) stays on the right; the header's
agent line grows the running chat total:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ (M) Reddit research ✎                                              📌      │
│     main · Σ 182.4k tok · $0.41                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│                                              ┌───────────────────────────┐ │
│                                        1m ⧉  │ how do burn buckets work? │ │
│                                              └───────────────────────────┘ │
│                                                                            │
│  (M) Margo                                                        1m ⧉    │
│  │ Burn buckets split non-task usage into interactive,                     │
│  │ unexplained, and runaway…                                               │
│  │ ▸ Searched the code · 2 calls · 8s                                      │
│  │                                                                         │
│  │ 14.2k in / 890 out · $0.03 · sonnet-5          ← metered: tokens + $    │
│                                                                            │
│  (M) Margo                                                        just now │
│  │ Here's the Oregon variant you asked about…                              │
│  │                                                                         │
│  │ 22.1k in / 1.2k out · pi-local                 ← subscription: no $     │
│                                                                            │
│  (M) Margo                                                                 │
│  │ Partial answer before you hit St⏹ Stopped                               │
│  │ 9.8k in / 210 out · $0.01 · sonnet-5           ← aborted: partial bill  │
│                                                                            │
│  (M) Margo                                                                 │
│  │ ⚠ session died  [session_lost]  [Try again]                             │
│  │                                                 ← error: NO footer      │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Message the agent…                                                   │  │
│  │  [+]                                                          [ ↑ ]  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

Reading the numbers: `in` is the turn's recorded input tokens — watching it
climb turn-over-turn IS the context-growth signal (D1: no percentage gauge,
ever). `Σ` in the header sums every turn the ledger knows about; it updates on
the settle refetch, so it ticks the moment a reply finishes. A turn the ledger
has nothing for shows NO footer — absence, never zero.

Footer anatomy (all pieces optional, comma of what's known):

```
14.2k in / 890 out · $0.03 · sonnet-5
└──┬──┘   └──┬───┘   └─┬──┘   └──┬───┘
 input     output    cost     model id tail (after last '/')
 tokens    tokens    (metered lane ONLY; <$0.01 for sub-cent)
```

## Dependency graph

```
T1 ledger prefix verb  ──►  T2 route decoration ──►  T4 chat client wiring
T3 kit footer (fold turnId + AgentTurn + Conversation)  ──►  T4
T5 docs (last)
```

T1→T2 strictly ordered (route calls the verb). T3 is independent of T1/T2
(pure client, opt-in props — no consumer until T4). T4 joins both sides.
Every commit leaves `bun run lint && bun run typecheck && bun run test` green.

## T1 — `feat(ledger): run-cost prefix read verb`

**Files:** `packages/core/src/execution/ledger.ts`, `src/core/execution-ledger.ts` (facade export), `tests/core/` ledger suite.

- `listRunCostsByPrefix(prefix: string): RunCostRow[]` — `WHERE run_id LIKE ? ESCAPE '\'` with `%`/`_`/`\` escaped in the prefix, ordered by `occurred_at`. Uses the PK index (prefix scan). Coordination-facts guard (`guard(...)`) like every other read; ledger-unavailable behavior matches existing read verbs.
- Tests: returns exactly the prefix's rows in time order; a prefix containing `%`/`_` matches literally; unrelated run ids excluded.
- **Acceptance:** verb green under the real-ledger test harness (`closeDb()` cleanup rules).

## T2 — `feat(chat): per-turn usage decoration on GET`

**Files:** `plugins/chat/lib/routes.ts` (+ small `plugins/chat/lib/usage.ts` if the mapping earns its own file), `tests/plugins/chat/` (new `usage.test.ts`).

- GET `/chats/:chatId` adds:
  - `usage: Record<turnId, TurnUsageDto>` — rows from `listRunCostsByPrefix('chat:<chatId>:turn:')`, turnId = run_id tail; DTO `{ inputTokens?, outputTokens?, totalTokens?, cacheReadTokens?, costUsd?, model?, lane? }`, null columns omitted; `costUsd = cost_usd_micros / 1e6` ONLY when `lane === 'metered'` (D3).
  - `usageTotals: { inputTokens, outputTokens, turns, costUsd? }` — sums of known values; `costUsd` present only when ≥1 metered row contributed.
  - Ledger throw → log + omit both fields (the transcript still serves; honest absence — never a 500, never zeros).
- Tests: seed `recordRunCost` for a metered turn (with cost) + a subscription turn (no cost) + an auto-title row (`chat:<id>:title` — must NOT match the `:turn:` prefix); GET carries the map + totals; unknown turn absent; subscription DTO has no costUsd; ledger-down path omits fields.
- **Acceptance:** decoration correct against real ledger rows; auto-title spend never pollutes turn usage.

## T3 — `feat(sdk): turn usage footer in the conversation kit`

**Files:** `src/components/conversation/fold.ts`, `agent-turn.tsx`, `conversation.tsx`, `packages/sdk/src/components/index.ts` (type export), tests (`tests/sdk/conversation-fold.test.ts`, `tests/components/conversation-kit.test.tsx`).

- `fold.ts`: agent turns gain `turnId?: string` (from the split key already tracked). Additive — extend the fold suite (turnId present on split turns, absent on legacy adjacency-grouped ones).
- `ConversationTurnUsage` type + `AgentTurn` prop `usage?` → footer line under the items (left column, after aborted/error affordances), muted `text-[11px]`, formats per the mockup: `formatTokens` compact (k at ≥1000, one decimal), `$X.XX` (`<$0.01` sub-cent), model id tail. Renders nothing when no displayable field (D4).
- `Conversation` prop `turnUsage?: Record<string, ConversationTurnUsage>` → passes `usage` to agent turns by `turnId`. Default absent = zero change (no consumer opts in this commit).
- Tests: footer lane matrix (metered with $, subscription without, empty → no footer, error turn never gets one), formatting pins, Conversation plumb by turnId.
- **Acceptance:** kit-only; app renders byte-identical until T4.

## T4 — `feat(chat): usage footers + chat total in the thread`

**Files:** `plugins/chat/components/use-chat-data.ts`, `chat-view.tsx`, `tests/plugins/chat/chat-page.test.tsx` (+ stream-client additions).

- `useChatStream.load` unpacks `usage`/`usageTotals` from the GET body (rides alongside `meta`; exposed on the hook's return).
- `ChatView`: `turnUsage` into `Conversation`; header agent line gains the `Σ` chip (mockup) — hidden entirely when totals are empty. Settle refetch already refreshes both (no new events).
- Tests: settled turn shows its footer; header chip renders totals and skips rendering with no data; footer appears after a turn settles (refetch path).
- **Acceptance:** #733 acceptance criteria — historical turns show usage, footer lands at settle without reload, unknown renders as absent.

## T5 — `docs(knowledge): chat/kit usage visibility`

- `chat-plugin.md`: GET decoration, unit-per-lane display rule, Σ header chip, D1 no-gauge decision.
- `conversation-kit.md`: fold `turnId`, `AgentTurn.usage`, `Conversation.turnUsage`.
- README + docs-site checked (expected: no impact). `execution-ledger.md` knowledge: add the prefix verb one-liner.

## Checkpoints & gates

- Per-commit: lint + typecheck + full suite (lint-is-part-of-the-gate).
- After T4: live smoke — open an existing chat with history (past turns light up), run one fresh turn (footer at settle, Σ ticks).
- After T5: push, PR referencing #733; Mark tests live before merge.
- Rollback: revert the offending commit; T3 is dormant without T4; T1/T2 are server-additive.

## Out of scope

Percentage gauges; brands/bits adoption; live mid-turn token ticking; settings toggles; any parallel spend math (the join reads run_costs — the ONE engine's rows).
