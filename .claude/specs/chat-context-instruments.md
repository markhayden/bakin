# Chat Context & Cost Instruments — Spec

**Issue:** #737 (refined after the 109% post-mortem — see `.claude/specs/chat-turn-usage.md` D1). Two instruments, two different questions, one view:
1. **Compaction bar** (chat header): how close is this session to auto-compaction — runtime-truth only.
2. **Cost explainer** (turn footers): why did this turn bill what it billed — from data already recorded.

Single-user box; no back-compat shims; tech-debt-lean. Stacked on `feat/chat-turn-usage` (PR #736) by decision — PR bases against it, retargets main when #736 merges.

## Decisions (interview 2026-07-25/26)

| # | Decision | Choice |
|---|---|---|
| D1 | Base | **Stack on the #736 branch** (`feat/chat-context-instruments` off `feat/chat-turn-usage`). |
| D2 | Footer format | **Billed-first, two muted lines**: `371.3k billed · 84% cached · ~10 requests · $0.04 · gpt-5.5` then `56.4k in / 2.1k out`. No-tool turns collapse to one line (requests part omitted — 1 request implied). `~` marks the derived request count. |
| D3 | Bar design | **Thin fill bar + reading + thresholds** in the header agent line: `[▓▓▓▓░░░░░|░░] 45.3k / 272k (17%)`, amber ≥70%, red ≥90%, a tick at the runtime-reported compaction threshold when present; recorded totals (`· 692.4k tokens · $0.41`) trail after. Window unknown → number-only `context 45.3k` (no bar). Capability absent / stats null → NOTHING (never a guess). |
| D4 | Honesty semantics (contract-pinned) | `tokens: null` = honestly unknown (e.g. immediately after a compaction before the next reply — mirrors Pi SDK's own `getContextUsage` semantics; or OpenClaw `totalTokensFresh !== true`). Thresholds absent when the runtime owns compaction opaquely (codex-native). Absence over zero everywhere. |

## The runtime contract member (instrument 1)

```ts
// packages/core/src/adapters/runtime/concepts.ts — sessions gains (storeStats? precedent):
sessions: {
  …,
  /**
   * Context stats for one Bakin thread's session, read AT REST (no turn,
   * no gateway calls, no session mutation). Optional: runtimes that cannot
   * answer omit the member; callers treat absence as unavailable — skip,
   * never error. Null = no session / nothing honest to report.
   */
  contextStats?(opts: { agentId: string; threadId: string }): Promise<RuntimeSessionContextStats | null>
}

interface RuntimeSessionContextStats {
  /** Current context tokens; null = honestly unknown (post-compaction gap, stale store). */
  tokens: number | null
  /** Model context window; null when unknown. */
  contextWindow: number | null
  /** Auto-compaction trigger (tokens); null when the runtime owns it opaquely. */
  compactionThreshold: number | null
  /** Last compaction, when detectable. */
  lastCompaction?: { at?: string; tokensBefore?: number; reason?: string }
  /** Model the stats describe (`provider/modelId`), when known. */
  model?: string
}
```
Keyed on `{agentId, threadId}` — the thread→session mapping is adapter-private on both runtimes; chat knows both values. Percent is computed by the CLIENT only when tokens+window are both present.

## Ground truth (explorer briefs, verified on this box)

### Pi (`packages/adapter-pi/`) — file-only implementation
- Thread→file: `getThreadSessionFile(agentId, threadId)` (`sessions.ts:56`) over `bakin-threads.json` — verified live (`chat:<uuid>` keys present). One small JSON read.
- `SessionManager.open(file, sessionsDir, cwd)` read-only (caveat: rewrites pre-v3/empty files once — accepted); `getBranch()` + `buildSessionContext()` give entries + the session's recorded model.
- Current context = the SDK's OWN algorithm (`getContextUsage`, mirrored — `estimateContextTokens` is NOT exported, re-implement ~12 lines over exported `calculateContextTokens` + `estimateTokens` + the valid-usage predicate: skip `stopReason` aborted/error and all-zero usage): last valid assistant `usage.totalTokens` + chars÷4 for entries after it. Post-compaction with no new assistant usage → `tokens: null` (SDK parity).
- Threshold: `contextWindow − reserveTokens` via `createTurnSettingsManager(workspace, agentDir).getCompactionSettings()` (defaults enabled/16384/20000; `shouldCompact = tokens > window − reserve`).
- Window/model: `buildSessionContext().model` → `findPiModel()` → `contextWindow`; fallback agent-record/routing ladder only when the session lacks a model.
- Compaction: durable `{type:'compaction', timestamp, tokensBefore, …}` entries; `getLatestCompactionEntry` exported. NEVER: `SessionManager.create`, `createAgentSession` (mutates + heavy), or `withThreadLock` for a read; mid-turn reads are one-turn stale, never torn.

### OpenClaw (`packages/adapter-openclaw/`) — store-only implementation (NOT the trajectory)
- The trajectory is the WRONG source (embedded path accumulates usage across API calls; OpenClaw's own types say so). The RIGHT source is `sessions.json`: `totalTokens` (last-call prompt) gated on `totalTokensFresh === true`, `contextTokens` (window), `compactionCount`/`compactionCheckpoints[]` (`createdAt`/`reason`/`tokensBefore|After`). Copy OpenClaw's own `buildSessionUsageSnapshot` gate verbatim. Verified live: 182/184 Bakin sessions carry all three fields; 2 null → unknown.
- Lookup is pure: `openClawCliSessionId(agentId, threadId)` (deterministic uuid) → store key `agent:<id>:explicit:<cliSessionId>` → `readSessionStoreCached` (mtime-guarded LRU — already exists). No RPC, no scan.
- Threshold: ONLY from a runtime-written `contextBudgetStatus` entry (embedded compactor persists it; deriving from `agents.defaults.compaction` config is BANNED — config guessing), with a coherence guard (threshold > window → null; the budget status and contextTokens can be written against different models). **Codex-native compaction → `compactionThreshold: null`.** Window comes only from the stored `contextTokens` — no fabricated fallbacks. AMENDED post-review: an over-window `totalTokens` (the 109% shape) reads `tokens: null` — incoherent data is unknown, NEVER clamped to a calm 100%.
- Store entries exist only after the first accepted run; `sessions cleanup` can prune → null, honest.

### Instrument 2 — cost explainer (CLIENT-ONLY; zero server change)
- The #736 usage DTO already carries `totalTokens` (=billed), `cacheReadTokens`, `inputTokens`, `outputTokens`, `costUsd`, `model`.
- `billed` = totalTokens (fallback in+out when absent); `cached%` = cacheRead/billed (omit when cacheRead unknown); `~requests` = the turn's tool-call count + 1, counted from the turn's OWN activity items inside AgentTurn (fold already delivers them) — shown only when ≥1 tool call.
- Legacy rows without totals keep the current single-line footer (honest degradation).

## Mock & conformance

- **Imitation Crab:** `recordSessionStoreEntry` gains `contextTokens` (272000 mock window), `totalTokens` (grows per turn), `totalTokensFresh: true`; the `[[stale-context]]` per-message marker writes `totalTokensFresh: false`, pinning honest absence end-to-end (integration test). This alone makes OpenClaw `contextStats` testable end-to-end (dev:mock demo included).
- **Conformance** (clone the `cron` optional-member pattern exactly): option `contextStats?: 'present' | 'absent'`; declared-present ⇒ after a session-producing turn, `contextStats` returns sane values (`tokens ≤ contextWindow` when both present; never negative; null-honesty respected); declared-absent ⇒ member is `undefined`, never a throwing stub. Runners: openclaw 'present', pi 'present', mock 'absent' (default mock stays minimal).
- **Plumbing:** `src/lib/plugin-context-services.ts` narrows sessions to list/get — add the optional `contextStats` bind or plugins can't reach it.

## Chat integration

- **Server:** GET `/chats/:chatId` decorates `contextStats` via `ctx.runtime.sessions.contextStats?.({ agentId: chat.agentId, threadId: 'chat:'+chatId })` — feature-detected, try/catch → omit (the #736 `chatTurnUsage` join's honesty pattern). Refreshes on the existing mount/settle refetch.
- **Client:** new kit `ContextMeter` component (slim bar + label + thresholds + tick, `data-context-meter`, tooltip explains the reading + "runtime may compact at the tick/before the limit"); chat's ViewHeader renders it leading the usage chip. Footer redesign in kit `AgentTurn` (instrument 2) with the request count derived internally from the turn's activity items.

## Testing strategy

- Contract/conformance: the new checks against all three runners + a teeth case.
- adapter-pi: tmp PI_HOME with hand-written session JSONL fixtures — usage-bearing turn (exact tokens), post-compaction gap (null), compaction entry (lastCompaction), missing mapping (null), settings-derived threshold.
- adapter-openclaw: tmp OPENCLAW_HOME seeding `sessions.json` (the `runtime-session-stats.test.ts` harness pattern) — fresh entry, `totalTokensFresh:false` → tokens null, missing entry → null, checkpoint → lastCompaction, codex threshold null.
- Kit: ContextMeter states (normal/amber/red/tick/window-unknown/null → nothing); AgentTurn footer matrix (billed-first two-line, no-tool collapse, cached% omission, legacy fallback).
- Chat: GET decoration (stubbed contextStats), header bar render + absence, footer integration.
- Live smoke on dev:mock (`[[slow]]` + growing mock totals) and on the real Pi box.

## Commit ladder (each green: lint + typecheck + full suite)

1. `feat(runtime): sessions.contextStats contract member + conformance checks` — types, plugin-services bind, conformance (mock 'absent'), teeth.
2. `feat(adapter-pi): contextStats from session files` — impl + fixtures tests; pi conformance runner → 'present'.
3. `feat(adapter-openclaw): contextStats from the session store` — impl + tests + Imitation Crab store fields; openclaw conformance runner → 'present'.
4. `feat(sdk): ContextMeter + billed-first turn footer` — kit components + tests (dormant).
5. `feat(chat): compaction bar + cost-explainer wiring` — GET decoration + header + footer adoption + tests.
6. `docs(knowledge)` — runtime-capabilities.md (new member), chat-plugin.md, conversation-kit.md, dev-loop.md (mock fields); README check.

## Boundaries

- **Never:** context numbers derived from billing aggregates (the 109% class — enforced by `tests/architecture/no-billing-derived-context.test.ts`, not just convention); gateway RPCs or session mutation on the GET path (no `SessionManager.create`/`createAgentSession`/thread locks); fabricated zeros, windows, or thresholds; percent without both tokens and window.
- **Out of scope:** brands/bits adoption of the meter; live mid-turn bar updates (settle cadence only; the turn's `~N out…` estimate covers in-flight growth); compaction *prediction*; surfacing contextStats anywhere beyond chat.
