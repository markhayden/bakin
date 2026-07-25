# Chat Per-Turn Usage Visibility — Spec

**Issue:** #733. Follow-up to the queue pass (#734). Single-user box; no back-compat shims; tech-debt-lean.

## Objective

Show real token usage (and cost, where honestly known) per settled turn directly in a chat thread, plus a running chat total — so the operator monitors spend and context growth in real time without leaving the conversation. **Zero new persistence, zero engine changes**: a display-layer join over the metering data every chat turn already writes.

## Decisions (interview 2026-07-25)

| # | Decision | Choice |
|---|---|---|
| D1 | Context-window display | **Absolute tokens only.** Per-turn `in` tokens are the honest window-growth signal. NO percentage gauge: the catalog's context field is a display string, and session runtimes (caching/compaction) make provider context ≠ transcript tokens — a gauge would be confidently wrong. Revisit only if a runtime ever reports true context size. |
| D2 | Surfaces | **Per-turn footer + chat-total in header.** Small muted always-visible footer on settled assistant turns (`14.2k in / 890 out · $0.03 · sonnet`); compact running total by the chat title (`Σ 182k · $0.41`). Both from one GET decoration. |
| D3 | Unit-per-lane (standing rule) | `lane='metered'` → tokens + $; `lane='subscription'` or NULL → tokens only. Dollars are NEVER fabricated. |
| D4 | Unknown is absent | A turn with no recorded row, or a row with no displayable numbers, renders NO footer — never zero. Aborted turns billed partial usage DO show their footer; error turns (never metered) don't. |

## Ground truth (verified)

- `run_costs` (ledger, `packages/core/src/execution/ledger.ts`): `run_id` PK, `agent`, `model`, `input_tokens`, `output_tokens`, `total_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd_micros`, `lane`, `work_class`, `occurred_at`. Chat turns record under `run_id = chat:<chatId>:turn:<turnId>` — historical turns join for free.
- Transcript rows carry `turnId`; `foldConversation` splits agent turns on it but does NOT expose it on `ConversationTurn` — one additive field needed.
- The settle refetch (done/error → `loadTranscript`) already re-GETs the chat — the footer for a just-finished turn arrives with no new events.

## Design

1. **Ledger read verb** (`packages/core/src/execution/ledger.ts` + facade `src/core/execution-ledger.ts`): `listRunCostsByPrefix(prefix: string): RunCostRow[]` — PK-index prefix scan (`run_id LIKE '<prefix>%'`, prefix sanitized for LIKE wildcards). Domain-neutral; chat passes `chat:<chatId>:turn:`.
2. **Route** (`plugins/chat/lib/routes.ts` GET `/chats/:chatId`): decorate with
   - `usage: Record<turnId, { inputTokens?, outputTokens?, totalTokens?, cacheReadTokens?, costUsd?, model?, lane? }>` (turnId = run_id tail; null columns omitted; `costUsd` only when `lane='metered'` and micros present),
   - `usageTotals: { inputTokens, outputTokens, costUsd?, turns }` (sums of known values; `costUsd` present only if ≥1 metered row).
   Ledger-unavailable → both fields omitted (honest absence, never a 500).
3. **Kit** (`src/components/conversation/`):
   - `fold.ts`: agent turns gain `turnId?: string` (additive; exhaustively-tested file — extend tests).
   - `AgentTurn` gains `usage?: ConversationTurnUsage` → renders the muted footer under the turn (after items, near the copy affordance row). Formatting: `formatTokens` compact (`14.2k`), `$` to 2 decimals (sub-cent → `<$0.01`), model shown as its id tail (after the last `/`).
   - `Conversation` gains `turnUsage?: Record<string, ConversationTurnUsage>` and passes each agent turn its entry by `turnId`. Opt-in; absent = today's rendering.
4. **Chat client**: `useChatStream`'s `load` unpacks `usage`/`usageTotals` (rides `meta`); `ChatView` passes `turnUsage` to `Conversation` and renders the header total chip next to the title (hidden when totals empty).
5. **Scope**: chat only opts in; brands/bits panels unchanged (kit props default off).

## Testing strategy

- Ledger: prefix verb returns exactly the prefix's rows; LIKE-wildcard chars in prefix are literal.
- Route: seed `recordRunCost` rows for two turns (one metered with cost, one subscription) → GET carries per-turn map + totals; unknown turn absent; ledger-down omits fields.
- Kit: fold exposes `turnId` (existing suite extended); AgentTurn footer lane matrix (metered $, subscription no-$, empty-usage no footer); Conversation plumb.
- Chat client: header total renders and updates after settle refetch; footer appears on a settled turn.

## Commit ladder

1. `feat(ledger): run-cost prefix read verb` — verb + facade + tests.
2. `feat(chat): per-turn usage decoration on GET` — route join + totals + tests.
3. `feat(sdk): turn usage footer in the conversation kit` — fold turnId + AgentTurn footer + Conversation plumb + tests.
4. `feat(chat): usage footers + chat total in the thread` — client wiring + tests.
5. `docs(knowledge): chat/kit usage visibility` — chat-plugin.md, conversation-kit.md; README check (expected no impact).

## Boundaries

- **Never:** parallel spend math (the join reads `run_costs` — the ONE engine's rows); fabricated zeros/dollars; percentage gauges (D1); engine/transcript-schema changes.
- **Out of scope:** brands/bits adoption; window-fill gauges; live mid-turn token ticking (usage exists only at settle); settings toggles.
