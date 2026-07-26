# Plan — Chat Context & Cost Instruments (#737)

**Spec:** `.claude/specs/chat-context-instruments.md` (approved 2026-07-26; grounded in two adapter exploration briefs)
**Branch:** `feat/chat-context-instruments` stacked on `feat/chat-turn-usage` (D1). PR bases against the #736 branch; retarget main when #736 merges. Verify HEAD before commits.

## Mockups (target UI)

Header — the compaction bar leads the agent line; recorded totals trail:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ (M) Goat Tying Results ✎                                           📌      │
│     Roscoe · [▓▓▓░░░░░░░░░░░░|░] 45.3k / 272k (17%) · 692.4k tokens · $0.41│
│               ↑ fill (amber ≥70%, red ≥90%)  ↑ compaction tick (when known)│
├────────────────────────────────────────────────────────────────────────────┤
```

Bar states (all test-pinned):

```
runtime reports everything:   [▓▓▓░░░░░░░░|░] 45.3k / 272k (17%)
threshold unknown (codex):    [▓▓▓░░░░░░░░░░] 45.3k / 272k (17%)     ← no tick
window unknown:               context 45.3k                          ← no bar, no %
post-compaction gap:          context — (compacted 2m ago)           ← tokens null, honest
capability absent / null:     (nothing — bar simply not rendered)
```

Turn footers — billed-first cost explainer (instrument 2):

```
  (M) Margo                                                        1m ⧉
  │ Here's how the top 5 did in the previous rounds… [table]
  │ ▸ 🔧 Ran commands · 2 calls
  │
  │ 133.8k billed · 78% cached · ~3 requests · $0.04 · gpt-5.5
  │ 29.2k in / 716 out

  (M) Margo                        ← no-tool turn: one line, no ~requests
  │ My pick: Hadley Thompson (WY).
  │ 45.5k billed · 96% cached · <$0.01 · gpt-5.5

  (M) Margo                        ← legacy row without totals: old format
  │ (an old reply)
  │ 14.2k in / 890 out · $0.03 · sonnet-5
```

Reading it: `billed` is what the turn cost in tokens (the sum across its tool-loop
requests — the big scary number, now explained); `cached` says most of it was
cheap prefix re-reads; `~N requests` says WHY it multiplied. The bar up top is the
separate question: how full the session actually is.

## Dependency graph

```
C1 contract + conformance (mock 'absent')
 ├─► C2 adapter-pi impl ('present')
 ├─► C3 adapter-openclaw impl + Imitation Crab fields ('present')
 └─► C5 chat GET decoration (needs the member; stubbable before C2/C3 land)
C4 kit ContextMeter + billed-first footer  — independent (client-only, dormant)
C5 chat wiring — needs C1 (server) + C4 (client); adapters make it LIVE
C6 docs — last
```

Order of execution: C1 → C2 → C3 → C4 → C5 → C6 (C4 could parallel C2/C3 but sequential keeps gates simple). Every commit: `bun run lint && bun run typecheck && bun run test` green.

## C1 — `feat(runtime): sessions.contextStats contract + conformance`

**Files:** `packages/core/src/adapters/runtime/concepts.ts` (member + `RuntimeSessionContextStats`), `src/lib/plugin-context-services.ts` (optional bind — the sessions facade narrows to list/get today), `packages/core/src/adapters/runtime/testing.ts` (mock omits it), `tests/integration/runtime-conformance/conformance.ts` (+ runners), teeth file.

- Contract exactly per spec (null-honesty doc comments are part of the contract).
- Conformance (clone the `cron` optional-member pattern): option `contextStats?: 'present' | 'absent'`; absent ⇒ member `undefined` (never a throwing stub); present ⇒ after the suite's session-producing turn, `contextStats({agentId, threadId})` returns non-null with `tokens === null || tokens >= 0`, `contextWindow === null || contextWindow > 0`, `tokens ≤ contextWindow` when both present, threshold `null || (>0 && ≤ window)`. Teeth: a deliberately-lying fake (tokens > window) must fail the check.
- Runners: mock 'absent' (default minimal shape), pi + openclaw 'present' — **added in C2/C3 when the impls land**, C1 wires the check itself.
- **Acceptance:** conformance suite green with mock 'absent'; teeth bites.

## C2 — `feat(adapter-pi): contextStats from session files`

**Files:** `packages/adapter-pi/src/sessions.ts` (+ small `context-stats.ts` if it earns it), `packages/adapter-pi/src/runtime.ts` (wire member), `tests/adapter-pi/context-stats.test.ts`, pi conformance runner → `'present'`.

- Per spec: `getThreadSessionFile` → null when unmapped; `SessionManager.open` (accept the one-time pre-v3 migration caveat); branch + `buildSessionContext`; re-implement `estimateContextTokens` (~12 lines over exported `calculateContextTokens` + `estimateTokens` + valid-usage predicate: skip aborted/error/all-zero); compaction guard via `getLatestCompactionEntry` — post-compaction with no valid newer usage ⇒ `tokens: null` + `lastCompaction {at, tokensBefore}`; threshold `window − reserveTokens` via `createTurnSettingsManager(...).getCompactionSettings()` (disabled ⇒ threshold null); model from session (`buildSessionContext().model`) → `findPiModel` → window, agent-record/routing fallback only when session is model-less.
- NEVER: `SessionManager.create` / `createAgentSession` / `withThreadLock` on this path.
- Tests (tmp PI_HOME, hand-written JSONL fixtures): exact tokens from last valid usage (+chars÷4 tail), aborted/error usage skipped, post-compaction null + lastCompaction, unmapped thread null, threshold derivation incl. disabled, session-model precedence.
- **Acceptance:** pi conformance 'present' green.

## C3 — `feat(adapter-openclaw): contextStats from the session store + mock fields`

**Files:** `packages/adapter-openclaw/src/sessions.ts` (or `session-store.ts`), `runtime.ts` (wire), `tests/adapter-openclaw/context-stats.test.ts`, `dev/imitation-crab/gateway.ts` (`recordSessionStoreEntry` + stale scenario), openclaw conformance runner → `'present'`.

- Per spec: `openClawCliSessionId(agentId, threadId)` → explicit store key → `readSessionStoreCached`; reuse the newest-`updatedAt` dedupe (a session can sit under `:main` and `:explicit:` keys); gate on `totalTokensFresh === true` (else `tokens: null`); `contextWindow` from `contextTokens` with `models.listAvailable()` fallback; threshold ONLY when the embedded compactor applies (`window − reserveTokensFloor(20000) − softThreshold(4000)` from `agents.defaults.compaction` config), codex-native ⇒ null; `lastCompaction` from `compactionCheckpoints[]` (newest: `createdAt`/`reason`/`tokensBefore`), `compactionCount` as the cheap has-compacted signal.
- Mock: store entries gain `contextTokens: 272000`, `totalTokens` growing per turn, `totalTokensFresh: true`; error/stale scenario writes `totalTokensFresh: false` (pins honest null).
- Tests (tmp OPENCLAW_HOME seeding `sessions.json` — clone the `runtime-session-stats.test.ts` harness): fresh entry, stale flag ⇒ null tokens, missing entry ⇒ null, checkpoint ⇒ lastCompaction, codex threshold null, window fallback.
- **Acceptance:** openclaw conformance 'present' green against the mock.

## C4 — `feat(sdk): ContextMeter + billed-first turn footer`

**Files:** `src/components/conversation/context-meter.tsx` (new), `turn-usage.ts` (footer part builders), `agent-turn.tsx` (footer redesign; request count from the turn's own activity items), SDK components index, tests (`conversation-kit.test.tsx`, new `context-meter.test.tsx`).

- `ContextMeter` props = `RuntimeSessionContextStats`-shaped DTO; renders the mockup's five states; amber/red fill classes at 70/90%; tick positioned at threshold/window %; tooltip copy; `data-context-meter`.
- Footer: line 1 `X billed · Y% cached · ~N requests · $ · model-tail` (requests only when the turn has ≥1 tool call — counted from `turn.items` activity calls; cached% omitted when cacheRead unknown; billed falls back to in+out; both absent ⇒ legacy single-line format). Line 2 `in / out`. `~` only on requests.
- Tests: meter state matrix incl. null-honesty renders-nothing; footer matrix (tool turn two-line, no-tool collapse, cached omission, legacy fallback, sub-cent `<$0.01`); no consumer opts in yet — zero app change.
- **Acceptance:** kit-only; app byte-identical until C5.

## C5 — `feat(chat): compaction bar + cost-explainer wiring`

**Files:** `plugins/chat/lib/routes.ts` (GET decoration), `plugins/chat/components/use-chat-data.ts` + `chat-view.tsx`, tests (`usage.test.ts`, `chat-page.test.tsx`).

- GET: `contextStats` field via `ctx.runtime.sessions.contextStats?.({agentId, threadId: 'chat:'+chatId})` — feature-detect, try/catch → omit (chatTurnUsage's honesty pattern).
- Client: unpack beside usage state; ViewHeader renders `ContextMeter` leading the chip (totals trail); AgentTurn adoption of the new footer is automatic (kit-side) — chat passes nothing new for instrument 2.
- Tests: GET decoration (stubbed adapter member present/absent/throwing), header bar states, footer visible on a tool-heavy turn, absence cases.
- **Acceptance:** #737 acceptance criteria — bar never exceeds 100%, absent-capability shows nothing, compaction visible (null gap + lastCompaction copy), tool-heavy footer explains its bill.
- **Checkpoint:** live smoke — dev:mock (`[[slow]]` + growing mock totals → bar fills across turns; `[[tool]]` → footer explains) AND the real Pi box (restart dev server; open the goat-tying chat: bar should read the real ~45k/272k).

## C6 — `docs(knowledge)`

- `runtime-capabilities.md`: the new optional member + null-honesty semantics + per-adapter sources.
- `chat-plugin.md`: both instruments, bar states, footer format; `conversation-kit.md`: ContextMeter + footer; `dev-loop.md`: mock store fields + stale scenario.
- README + docs-site check (expected: no impact). Update `.claude/specs/chat-turn-usage.md` D1 cross-ref (the honest gauge now exists via #737).

## Gates & rollback

- Per-commit full gate (lint is part of it). After C5: the live smoke checkpoint before docs.
- Rollback: revert the offending commit — C1–C3 are server-additive (nothing consumes until C5), C4 dormant, C5 is the only user-visible flip.
- Push + PR (base `feat/chat-turn-usage`) referencing #737; Mark live-tests before merge; retarget to main when #736 merges.

## Out of scope

Brands/bits meter adoption; mid-turn live bar updates; compaction prediction; trajectory-derived context (banned — the 109% class); surfacing contextStats beyond chat.
