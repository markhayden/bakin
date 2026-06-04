# Session-Death Hardening: Oversized Output Detection, Recovery & Prevention

**Status:** Draft — pending approval
**Date:** 2026-06-04
**Driver:** Repeated production incident (task-56d382ae): research agent emitted 500–700KB completions in a single turn → OpenClaw session ended `interrupted` → Bakin saw only "OpenClaw chat gateway request timed out: agent" → task blocked with a red-herring reason after burning two full dispatch cycles.

## 1. Objective

Make Bakin deterministically detect, diagnose, recover from, and prevent the "oversized agent output kills the OpenClaw session" failure class — without modifying OpenClaw itself. All work is Bakin-side: core dispatch, the OpenClaw adapter, the assets/tasks plugins, and prompt/rule surfaces.

Success means:

1. **No more red herrings.** A session death is reported as what it is ("OpenClaw session interrupted after oversized model completion (708KB); agent never called assets_save or tasks_complete; session 69435183…") — never as a generic gateway timeout.
2. **Fail fast.** Bakin notices the session died within seconds (trajectory tail), not after the 630s transport timer expires.
3. **Self-healing by default.** Diagnose → salvage partial output as an asset → one corrective re-dispatch → automatic decomposition into subtasks → block only as last resort, with an actionable reason.
4. **Prevention out of the box.** Every dispatch prompt carries artifact-first output discipline; orchestrator rules enforce checklist-style task shapes; multi-deliverable tasks are fine but deliverables are produced/saved **in succession**, never as one mega-response.
5. **Independent progress.** Tasks dispatch concurrently (bounded), each in its own session — one slow 10-minute turn no longer stalls every other task on the board.

### Confirmed root cause (validated against code)

- Dispatch sends the turn via gateway WS RPC, `expectFinal: true`, 630s transport timeout (`packages/adapter-openclaw/src/runtime.ts:1165`).
- OpenClaw writes `model.completed` (oversized, truncated at 262,144 bytes) then `session.ended` `status:"interrupted"` to the session **trajectory** file — but never delivers a final RPC frame.
- The RPC timer fires (`gateway-rpc.ts:231-233`) → `"OpenClaw chat gateway request timed out: agent"`.
- `classifyDispatchFailureDetail()` (`src/core/dispatch.ts:248-324`) buckets it as generic `dispatch_timeout`; `reconcileRejectedDispatch()` (`dispatch.ts:428-499`) sees progress-log growth → blocks with `"Agent runtime timed out before reporting completion."`
- Evidence of death was on disk ~106s before Bakin gave up; Bakin never read it.
- Both incident dispatches landed in the **same** OpenClaw session (dispatch passes no `threadId`), so the second attempt replayed the bloated context and died identically.

### Secondary findings (uncovered during spec, also addressed here)

- **Shared-session bloat:** with no `threadId`, every task turn appends to the agent's one long-running session — context accumulates across tasks and directly contributes to oversized completions.
- **Serial dispatch bottleneck:** the dispatch loop serially `await`s every send (`dispatch.ts:652`, workflow `:1079`). One 10-minute turn blocks dispatching *all* other tasks — even to idle agents. This is why parallel task fan-out appears to make no independent progress.
- **Mutex overlap bug:** `DISPATCH_TIMEOUT_MS` force-releases the dispatch mutex at 3 minutes, but an awaited send legally runs 630s — a second dispatch cycle can start while the first is mid-flight.
- **Parallel-ready transport:** the gateway RPC client has no per-agent serialization (single WS, UUID-keyed pending map) — concurrent turns are already supported client-side. Whether the OpenClaw gateway serializes per agent internally is unverified (rig validation item, see §10).

## 2. Decisions (locked with Mark)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope | All Bakin-side layers. OpenClaw untouched; adapter may watch/interpret/abort. Agent-package content (Jessica SOUL.md in bakin-bits-official) is a follow-up outside this repo. |
| D2 | Detection | **Both** fail-fast (live trajectory tail watches `session.ended` during the pending RPC, aborts immediately with diagnosis) **and** post-mortem (on timeout, read trajectory tail and classify) as fallback. |
| D3 | Salvage | Truncated completion text (`model.completed.data.assistantTexts`) saved as a task-linked managed asset (type `text`, tag `salvaged-output`). |
| D4 | Recovery | Escalation ladder: 1× corrective re-dispatch with explicit failure feedback → automatic decomposition dispatch (assigned agent splits into subtasks, one deliverable each) → block with full diagnosis. |
| D5 | Prevention | Artifact-first + produce-in-succession rules in both dispatch prompt builders; strengthened orchestrator managed rules; advisory checklist lint in `bakin_exec_tasks_create`. Multi-deliverable tasks remain legal — checklist semantics. |
| D6 | Reporting | Structured audit event + rich `blockedReason` + task-log entry with structured data + plugin health check counting incidents in last 24h. |
| D7 | Sessions | **Per-attempt session**: dispatch passes `threadId = task:<taskId>:a<attempt>`. Deterministic forensics; corrective re-dispatch starts clean; ends cross-task context bloat. |
| D8 | Tech debt | This machine is the only user. No backwards compatibility, no shims. Clean contracts. |
| D9 | Concurrency | **Concurrent dispatch folded in**: bounded-parallel sends (global + per-agent caps), in-flight turn registry with settle-time reconciliation, dispatch mutex scoped to the scan/fire phase (fixes the 3-min/10-min overlap bug). |
| D10 | Audit findings | Adapter/dispatch audit (2026-06-04) findings folded in: structured error classification replacing ALL substring matching, stream-leak fix, stable idempotency keys, real session ids in MessageResult, dispatchSingleTask state fix, dependency-stranding guard, dead-surface deletion, prompt roster/drift fixes. Independent IO-efficiency cluster deferred to `.claude/specs/dispatch-io-efficiency.md`. |

## 3. Architecture

### 3.1 Provider-neutral diagnosis contract (packages/core)

New types in `packages/core/src/adapters/runtime/concepts.ts`:

```typescript
export type RuntimeTurnFailureReason =
  | 'session_interrupted'   // session.ended status !== 'success', not a runtime timeout
  | 'runtime_timeout'       // session/turn genuinely timed out server-side
  | 'transport_timeout'     // RPC timer fired and no session evidence found (today's generic case)

export interface RuntimeTurnDiagnosis {
  reason: RuntimeTurnFailureReason
  sessionId?: string
  sessionStatus?: string          // raw provider status, e.g. 'interrupted'
  timedOut?: boolean
  completionBytes?: number        // total bytes of final assistant output
  outputTruncated?: boolean       // provider truncated the recorded completion
  oversizedOutput?: boolean       // completionBytes > threshold
  lastToolCall?: string           // last tool the agent invoked before death
  salvagedText?: string           // truncated completion text (capped), for salvage
  usage?: { input?: number; output?: number; total?: number }
  detail?: string                 // one-line human-readable diagnosis
}

export class RuntimeTurnError extends Error {
  readonly diagnosis: RuntimeTurnDiagnosis
}
```

The adapter throws `RuntimeTurnError` from `messaging.send()` whenever it can diagnose; otherwise existing generic errors continue to flow. Bakin core never reads provider files — the diagnosis is assembled entirely inside `packages/adapter-openclaw/`.

`oversizedOutput` threshold: `settings.dispatch.oversizedOutputBytes` (default `131072` / 128KB), read by core and passed to the adapter per-send via `MessageArgs` metadata — core owns policy, adapter owns measurement.

**Structured error classification (replaces ALL substring matching — audit C1/H1).** Today the adapter emits free-text errors and dispatch classifies by substring (`'request timed out'`, `'socket error'`, `'fetch failed'`, `'no available auth profile'`, `'suspending lanes'`, `'turn_completion_idle_timeout'`, an HTTP-status regex that CLI exit codes don't reliably match) — and some adapter strings (`"<label> disconnected"`, `"is not connected"`) match *nothing*, falling into the generic bucket. Worse, `runOpenClawAgentGateway` rethrows everything as `new Error(...)` **without `cause`** (`runtime.ts:1172`), so `classifyDispatchError`'s `err.cause.code` / `err.name` checks never fire and every transport failure lands in the long structural cooldown. Replacement:

```typescript
export type RuntimeErrorKind =
  | 'transport'          // socket drop, disconnect, fetch failure — transient
  | 'timeout'            // RPC/transport timer fired
  | 'session_death'      // carries RuntimeTurnDiagnosis
  | 'provider_cooldown'  // auth/lane/cooldown — provider unavailable
  | 'runtime_failed'     // structured runtime error (HTTP-status class)

export class RuntimeError extends Error {
  readonly kind: RuntimeErrorKind
  readonly cause?: unknown        // original error always preserved
}
// RuntimeTurnError extends RuntimeError with kind 'session_death' + diagnosis
```

The adapter maps every failure path (gateway RPC timeout, socket error, disconnect, not-connected, CLI exit, cooldown strings from the provider) to a `RuntimeError` with the right `kind` before it crosses the boundary. `classifyDispatchError` / `classifyDispatchFailureDetail` classify on `kind` exclusively; all substring matching in `dispatch.ts` is deleted. Provider wording changes can no longer silently flip block-vs-retry behavior.

**Real session identity in `MessageResult` (audit B-H2).** `messaging.send` currently returns `id: msg-${Date.now()}` while holding the real provider `sessionId`/`runId` — return them: `{ id: <runId>, metadata: { sessionId, runId } }`. Forensics, audit events, and the UI get a real correlation handle.

### 3.2 Adapter: trajectory forensics (packages/adapter-openclaw)

New module `packages/adapter-openclaw/src/trajectory-forensics.ts`:

- **Schema (verified against real files, `openclaw-trajectory` schemaVersion 1):** events `session.started`, `context.compiled`, `prompt.submitted`, `model.completed` (`data.assistantTexts`, `data.usage`, `data.timedOut`, `data.aborted`, `data.promptError`), `session.ended` (`data.status`, `data.timedOut`, `data.promptError`). Trajectory file lives at `<sessions dir>/<sessionId>.trajectory.jsonl` — **sibling of** the `<sessionId>.jsonl` the adapter already reads. Parser must be tolerant of unknown event types and missing fields.
- `diagnoseSessionDeath(trajectoryPath, sinceByteOffset)` → `RuntimeTurnDiagnosis | null`: scans events after the offset; classifies from the last `session.ended` + preceding `model.completed`; computes `completionBytes` from `assistantTexts`; extracts last tool call from the sibling session `.jsonl` (existing transcript parsing); caps `salvagedText` at 262,144 bytes.
- **Fail-fast:** `runOpenClawAgentGateway()` gains a trajectory watcher alongside the existing 200ms session-activity poll. It records the trajectory byte offset at turn start; when it sees a `session.ended` for this turn (matched by `runId`/recency) with non-success status, it rejects the pending RPC immediately with `RuntimeTurnError` (and cancels the transport timer).
- **Post-mortem:** if the transport timer fires anyway (trajectory missing/unreadable/racing), catch the timeout, attempt `diagnoseSessionDeath()`, and re-throw as `RuntimeTurnError` when evidence exists; otherwise rethrow the original error (→ `transport_timeout` handling unchanged).
- Forensics requires knowing the session → depends on D7 (per-attempt `threadId` → deterministic `sessionId` via existing `openClawCliSessionId()` → trajectory path via existing `resolveOpenClawSessionFile()` conventions). When no `threadId` was passed (non-dispatch sends), forensics is skipped — behavior unchanged.

Additional adapter fixes folded in from the audit:

- **Stream-leak fix (C2):** `mergeChatStreams` gets a `try/finally` so an early consumer break aborts `stopSecondary()` — today every abandoned stream leaks a 200ms session-file poller that runs forever.
- **Stable idempotency key (H2):** replace `idempotencyKey: bakin-${randomUUID()}` (fresh per call — dead weight) with the per-attempt key `bakin:task:<taskId>:a<attempt>` derived from `threadId`, making any future transport retry of the same logical turn actually idempotent. Non-dispatch sends keep a random key.
- **Dead code deletion:** unused `headers()` agent/session params + unreachable branches, `lastModelListFailureMessage` field, redundant double connect timer (`gateway-rpc.ts` connectState + connect-RPC racing 5s timers — keep one).

### 3.3 Dispatch: per-attempt sessions (src/core/dispatch.ts)

- `sendDispatchMessage(agentId, content, taskId, threadId)` passes a per-dispatch session key.
- **threadId scheme:** `task:<taskId>:d<seq>` for regular tasks; `task:<taskId>:step:<stepId>:d<seq>` for workflow steps (parallel step agents must not collide). `seq` is a **monotonic per-task dispatch sequence** stored in `.dispatch-state.json` and incremented on every send — NOT the failure count, which resets on success and would silently resume an old session on a later re-dispatch (e.g. dependency continuation).
- Applies to regular, single-task, and workflow dispatch paths.
- **Workflow-step ladder variant:** workflow steps get diagnosis + salvage + corrective re-dispatch, then **block** — no decomposition rung, because step structure is owned by the workflow engine, not the agent.

**Caller classification (verified 2026-06-04 — six `messaging.send` callers exist).** Only *task-work* sends get per-attempt sessions:

| Caller | Class | Session |
|--------|-------|---------|
| `dispatch.ts` (all three dispatch paths) | task work | `task:<taskId>:a<n>` |
| `continuation.ts` dependency resume | task work | **becomes a full re-dispatch** (see below) |
| `task-service.ts:370` orchestrator complete-notification | notification | default session (no threadId) — unchanged |
| `watchdog.ts:104` stale-task alert | notification | default session — unchanged |
| `doctor.ts:102` health alert | notification | default session — unchanged |
| `agents.ts:75` / API message | conversational | default session — unchanged (UI chat threading is out of scope) |

**Continuation fix (would be a bug under per-attempt sessions):** `continuation.ts` currently sends a bare "Your dependency task X is now Done. Resume your task…" nudge that only works because it happens to land in the shared session still holding the original context. Replace it with a full re-dispatch through the normal dispatch path (self-contained `buildDispatchMessage` prompt, fresh attempt session, completed-dependency outputs/assets referenced). This removes a silent dependence on unbounded session history.

**Session economics (why per-attempt wins):** a session start costs a one-time ~8–15KB compiled context (SOUL/AGENTS/TOOLS + tool defs); a shared session pays ever-growing history as input tokens on every subsequent turn. Per-attempt = fixed, predictable context per turn, and `sessionId` in `MessageResult.metadata` enables per-task cost attribution (`agent-usage.ts` already parses per-session usage from session JSONL).

**Proliferation guard:** sessions.json entries each carry a full `skillsSnapshot` and nothing prunes them; the adapter re-reads the file per lookup. Adapter gets an mtime-guarded cache for session-store reads. OpenClaw session retention is an upstream concern (we never write `~/.openclaw`) — added to rig validation (§10).

### 3.4 Salvage: assets hook (plugins/assets)

- Assets plugin registers hook `assets.saveFromSource` (HookRegistry, naming `{pluginId}.{operation}`) wrapping the existing `upsertFromSource()` — input `{ filePath, taskId, agent, type, description, tags, tool }`, output `{ assetId, version, changed }`.
- On a `session_interrupted`/oversized diagnosis with `salvagedText`, dispatch writes the text to `<contentDir>/tasks/salvage/<taskId>-a<attempt>.md` and invokes the hook (`type: 'text'`, tags `['salvaged-output']`). Upsert-by-source-path keeps repeat salvage idempotent.
- Salvaged `assetId` is recorded in the diagnosis flow and referenced in the corrective/decomposition prompts and `blockedReason`.

### 3.5 Recovery ladder (src/core/dispatch.ts)

Extend `DispatchState.failedDispatches[taskId]` (no compat concerns):

```typescript
interface FailureRecord {
  lastAttempt: number
  count: number
  kind: DispatchFailureKind
  sessionDeath?: {
    correctiveAttempted: boolean
    decompositionAttempted: boolean
    lastDiagnosis: RuntimeTurnDiagnosis   // minus salvagedText
    salvagedAssetId?: string
  }
}
```

`reconcileRejectedDispatch()` branches on `err instanceof RuntimeTurnError` with `reason === 'session_interrupted'`:

1. **First death:** salvage → audit `task.runtime_session_died` → task back to `todo` with `correctiveAttempted: true` flag; next dispatch injects a `PREVIOUS ATTEMPT FAILED` prompt section: why it died (size, session status), artifact-first instructions (write each deliverable to a file → `bakin_exec_assets_save` → `bakin_exec_tasks_log_progress` → next), salvaged asset reference, keep chat output under the threshold.
2. **Second death:** salvage again → audit → re-dispatch with a **decomposition prompt**: do NOT produce deliverables; create one subtask per remaining deliverable via `bakin_exec_tasks_create` (`parentId` = this task), register `bakin_exec_tasks_set_dependency`, reference the salvaged assets, then stop. Mark `decompositionAttempted: true`. Subtasks flow through normal dispatch (each inherits the artifact-first rules); the parent is held by the existing dependency-eligibility gate and re-dispatches when children complete.
3. **Third death (decomposition itself died):** block with full diagnosis: `blockedReason` = human-readable diagnosis + salvaged asset id + explicit next-step guidance ("split this task manually or reduce deliverable scope"). Audit `task.runtime_failed_blocked` carries the structured diagnosis.

Session-death failures are **never** retried via the generic transient/structural cooldown path — they are deterministic; the ladder replaces blind retries.

### 3.6 Reporting

- **Audit:** new kinds `task.runtime_session_died`, `task.corrective_redispatch`, `task.decomposition_dispatched`, each carrying `{ taskId, agent, sessionId, sessionStatus, completionBytes, outputTruncated, oversizedOutput, lastToolCall, salvagedAssetId, attempt }`. Flows to audit.jsonl + SSE + search automatically.
- **Audit query helper:** `queryAuditEvents(contentDir, { kinds, sinceMs })` in `src/core/audit.ts` (currently write-only; reads are ad-hoc). Used by the health check; removes future ad-hoc JSONL parsing.
- **Task log:** structured entry (`data` field) on every ladder transition.
- **Health check:** tasks plugin registers `session-death-incidents` (`plugins/tasks/lib/health-checks.ts`): warn when ≥1 `task.runtime_session_died` in last 24h, listing task ids + agents + sizes. Surfaces in `bakin doctor` + health dashboard.

### 3.7 Prevention

0. **Prompt-builder cleanup (audit #6, #7, #12):** while touching both builders — derive the triage roster from `runtime.agents.list()` instead of the hardcoded `(patch=execution, pixel=design/media, rolo=video/audio, jessica=research)` string (breaks custom-agent installs); extract a single shared tool-doc helper so the duplicated/drifted tool catalogs (e.g. `post_channel` gating) can't diverge; delete the dead `_port` params. Full catalog-to-persistent-context migration is deferred to the IO-efficiency spec.
1. **Dispatch prompts** (`buildDispatchMessage()` + `buildWorkflowDispatchMessage()`): new `OUTPUT DISCIPLINE — MANDATORY` section:
   - Any deliverable or output > ~8KB MUST be written to a workspace file and saved via `bakin_exec_assets_save` **before continuing**.
   - Multi-deliverable tasks: treat deliverables as a checklist — produce → save asset → log progress → next. Never draft multiple deliverables in one response.
   - Chat/completion text stays short: summary + asset ids only.
   - Optionally split remaining work into subtasks via the existing DEPENDENCY PATTERN when deliverables are independent.
2. **Orchestrator managed rules** (`src/core/agent-rules/managed-blocks.ts`): sharpen the existing "one clear task per agent per deliverable" rule — multi-deliverable requests must be written as an explicit checklist in the task description (or a workflow); agents produce and save each item in succession.
3. **Task-creation lint** (`bakin_exec_tasks_create` in plugins/tasks): advisory only — when a description enumerates ≥3 deliverables without checklist formatting, the tool result includes a nudge to structure them as a checklist. Never rejects.

### 3.7b Dead-surface deletion (adapter contract — audit M1/M2/L1/L2)

Tech-debt priority, no compat needed — delete interface surface that lies or has zero consumers:

- `AgentRuntimeAdapter.tasks.*` — `dispatch` fabricates colliding `flowId: flow-<taskId>`, `getExecutionStatus` always returns `'unknown'`, `listExecutions` returns `[]`, no real consumer (real dispatch uses `messaging.send`). Delete the namespace; the in-flight turn registry (§3.8) is the real execution-tracking model.
- `agents.heartbeat()` — a HEARTBEAT.md file-stat masquerading as liveness, zero consumers; the real system is `~/.bakin/heartbeats/`. Delete.
- `channels.onMessage` / `channels.onInteraction` — permanent no-op stubs, zero subscribers. Delete.
- `tools.list()` — unconditionally returns `[]` (a lie). Delete or implement; default delete.
- `blockTask(agent)` vestigial param and similar `void`-ed params.

Remove the corresponding bindings in `plugin-context-services.ts` / `plugin-permissions.ts` and any imitation-crab mock stubs.

### 3.8 Concurrent dispatch (src/core/dispatch.ts)

Today the dispatch loop serially awaits each send; a 10-minute turn stalls the entire board, and the 3-minute mutex force-release can start an overlapping cycle mid-send.

- **In-flight turn registry:** module-level `Map<taskId, InFlightTurn>` (`{ agentId, attempt, threadId, startedAt, promise }`). The dispatch cycle scans eligibility, moves tasks to `inProgress`, fires sends, registers them, and **returns immediately** — reconciliation (success path, `RuntimeTurnError` ladder, generic-failure cooldown) runs in `.then()/.catch()` settle handlers per turn. Restart safety is unchanged: in-flight promises die with the process and existing restart-recovery handles orphaned `inProgress` tasks via heartbeats.
- **Caps:** `settings.dispatch.maxConcurrentTurns` (global, default `3`) and `settings.dispatch.maxTurnsPerAgent` (default `1`). A task whose agent is at cap (or when the global cap is reached) is simply ineligible this cycle (new eligibility reason `'agent_busy'` / `'concurrency_cap'`) and is picked up by a later cycle. Per-agent default stays `1` until the rig validates OpenClaw gateway per-agent concurrency (§10); raising it requires only a settings change.
- **Mutex fix:** `DISPATCH_TIMEOUT_MS` now only guards the scan/fire phase (fast, file-IO bound). Sends are no longer under the mutex, eliminating the overlap hazard by construction. The `dispatchedSet` / in-flight registry guard against double-dispatching a task across cycles.
- **Watchdog/recovery interplay:** unchanged — stuck detection still keys off task-log timestamps; the registry is advisory for caps and reconciliation, not a source of truth for task state.
- **`dispatchSingleTask` state hygiene (audit #3, #12):** route `dispatched[]` cap/trim through one shared helper used by both dispatch paths; fix the broken cap (setting says `maxDispatched: 500`, trim slices to `-200` — honor the setting).
- **Lock scope (audit #13):** the state lock currently wraps the whole cycle including awaited sends, so a manual task kick can't run while a cycle is mid-send. With sends outside the lock (registry model), kicks interleave freely; the lock only guards `.dispatch-state.json` load/save.
- **Dependency-stranding guard (audit #11):** when `task.dependsOn` points at a task id that no longer exists in any column (hard-deleted by `archiveOldTasks`), treat the dependency as satisfied and log it instead of stranding the dependent forever. The decomposition ladder (§3.5) creates dependency chains, making this latent bug load-bearing.
- Combined with per-attempt sessions (D7), this makes multi-task progress genuinely independent across agents and, once the cap is raised, within a single agent.

## 4. Commands

| Action | Command |
|--------|---------|
| Full test suite | `bun run test` |
| Single test file | `bun test tests/path/foo.test.ts --isolate` |
| Dev loop (mock runtime) | `bun run dev:mock` |
| Reseed mock | `bun run mock:seed --force` |
| Type check / build | `bun run build` (or the repo's typecheck script) |
| Doctor | `bakin doctor`, `bakin check all` |

## 5. Project structure (files touched)

```
packages/core/src/adapters/runtime/concepts.ts      — RuntimeError/RuntimeErrorKind, RuntimeTurnDiagnosis, RuntimeTurnError, MessageArgs threshold plumbing, MessageResult session metadata, dead-surface deletion (tasks.*, agents.heartbeat, channels.onMessage/onInteraction, tools.list)
packages/adapter-openclaw/src/trajectory-forensics.ts — NEW: parser + classifier + salvage extraction
packages/adapter-openclaw/src/runtime.ts            — fail-fast watcher in runOpenClawAgentGateway; post-mortem on timeout; typed RuntimeError mapping with cause preserved; mergeChatStreams try/finally leak fix; stable idempotency key; real sessionId/runId in MessageResult; dead code deletion
packages/adapter-openclaw/src/gateway-rpc.ts        — typed error kinds on timeout/disconnect/not-connected/socket paths; single connect timer
packages/core/src/adapters/plugin-context-services.ts — remove deleted-surface bindings
src/core/dispatch.ts                                — threadId per attempt; recovery ladder; corrective/decomposition prompts; OUTPUT DISCIPLINE section; concurrent dispatch (in-flight registry, caps, scan-scoped mutex); kind-based classification (all substring matching deleted); roster from runtime.agents.list(); shared tool-doc helper; dispatched[] cap fix; dependency-stranding guard
src/core/audit.ts                                   — queryAuditEvents()
src/core/agent-rules/managed-blocks.ts              — sharpened orchestrator rules
packages/core/src/settings.ts                       — settings.dispatch.{oversizedOutputBytes, maxConcurrentTurns, maxTurnsPerAgent} defaults
plugins/assets/index.ts                             — assets.saveFromSource hook
plugins/tasks/index.ts + plugins/tasks/lib/health-checks.ts — create-lint nudge; session-death health check
dev/imitation-crab/                                 — trajectory fixture files + chat modes: session-death, slow-turn (exceeds transport timeout), idle-timeout; live JSONL writes during turns
tests/…                                             — unit + integration coverage (see §7)
.claude/knowledge/dispatch.md                       — recovery ladder + diagnosis docs
.claude/knowledge/adapter-architecture.md           — per-attempt sessions, forensics boundary note
.claude/knowledge/session-forensics.md              — NEW deep reference
CLAUDE.md                                           — Key Patterns blurb (one line + deep ref)
```

## 6. Code style

Repo conventions apply unchanged: TS strict, Zod at boundaries, functional preference, `createLogger('module')`, no empty catches, kebab-case files, conventional commits with scope. The forensics parser returns `null`/partial diagnoses rather than throwing — a broken trajectory file must never make a failure *less* diagnosable than today.

## 7. Testing strategy

All tests mock both content-dir resolvers + OpenClaw home (per CLAUDE.md CRITICAL rules), temp dirs, cleanup in `afterAll`.

1. **Forensics unit tests** (`tests/adapter-openclaw/trajectory-forensics.test.ts`): fixture trajectory files — clean success, interrupted+oversized (modeled on the real incident: 708KB completion truncated to 262,144), interrupted small, timed-out, malformed lines, missing file. Assert classification, byte counts, salvage capping, tolerance.
2. **Fail-fast integration**: simulated trajectory file growing during a pending request → request rejects with `RuntimeTurnError` before the transport timer; timer cancelled.
3. **Post-mortem fallback**: trajectory appears only after timeout fires → diagnosis still attached.
4. **Recovery ladder** (`tests/core/dispatch-session-death.test.ts`): mock runtime throwing `RuntimeTurnError` — assert attempt 1 → corrective re-dispatch prompt content + salvage hook invoked + audit kind; attempt 2 → decomposition prompt; attempt 3 → blocked with diagnosis-rich reason; generic timeouts still follow old cooldown path.
5. **threadId**: every dispatch path passes `task:<id>:a<n>`; attempt increments.
6. **Prompt content**: OUTPUT DISCIPLINE present in regular + workflow prompts; corrective section only after a death.
7. **Assets hook**: saveFromSource registered, idempotent re-salvage.
8. **Health check + audit query**: seeded audit.jsonl → correct 24h counting.
9. **Imitation-crab e2e**: mock gains a "session death" mode (oversized completion + interrupted end written to trajectory, no RPC final frame) → full ladder exercised against the dev rig.
10. **Concurrent dispatch** (`tests/core/dispatch-concurrency.test.ts`): N eligible tasks across agents → sends fire without serial blocking (slow mock send for agent A doesn't delay agent B); global + per-agent caps respected (`agent_busy` ineligibility); settle handlers reconcile success/ladder/cooldown correctly; no double-dispatch across overlapping cycles; mutex covers scan phase only; manual kick interleaves with an in-flight cycle.
11. **Error classification** (`tests/core/dispatch-error-classification.test.ts`): every `RuntimeErrorKind` maps to the right cooldown/block path; `cause` preserved through the adapter wrap (socket `ECONNRESET` → transient, not structural); disconnect/not-connected → `transport`; zero remaining substring assertions (grep-style architecture test that `dispatch.ts` contains no error-message `includes()` matching).
12. **Stream leak**: consumer breaks out of a `messaging.stream()` for-await early → activity poller is aborted (no orphaned interval/poll loop).
13. **Dependency stranding**: task with `dependsOn` → nonexistent id becomes eligible with a logged note.
14. **MessageResult identity**: send returns real provider sessionId/runId in metadata (mock asserts).

## 8. Boundaries

**Always:**
- All provider file access stays in `packages/adapter-openclaw/`; core consumes only `RuntimeTurnDiagnosis`.
- Diagnosis failures degrade gracefully to today's behavior — never worse.
- Every ladder transition is audited and task-logged.

**Ask first:**
- Any change to OpenClaw RPC params beyond `sessionId` (e.g. attempting session resume of interrupted sessions).
- Changing the 8KB prompt guidance threshold or 128KB oversized threshold defaults.
- Raising `maxTurnsPerAgent` above 1 by default (pending rig validation of gateway per-agent concurrency).

**Never:**
- Modify OpenClaw itself or write into `~/.openclaw/` (read-only forensics).
- Bakin writing runtime-memory or session content.
- Retry a diagnosed session-death through the generic cooldown loop.
- Backwards-compat shims (single-user machine).

## 9. Commit strategy (rollback checkpoints)

Each commit is independently buildable + testable; revert any suffix of the series to roll back cleanly.

1. `refactor(core): delete dead runtime-adapter surface (tasks.*, agents.heartbeat, channels.on*, tools.list)` — pure deletion, shrinks everything after.
2. `feat(core): RuntimeError/RuntimeErrorKind + RuntimeTurnDiagnosis contracts + oversized-output settings` — types only.
3. `refactor(adapter-openclaw): typed error mapping with cause preserved; kind-based classification in dispatch (delete all substring matching)` — fixes the structural-cooldown misclassification (C1/H1).
4. `fix(adapter-openclaw): mergeChatStreams try/finally — abort activity poller on early consumer break` (C2)
5. `feat(adapter-openclaw): trajectory forensics parser + post-mortem diagnosis`
6. `feat(adapter-openclaw): fail-fast session-death detection during pending turns`
7. `feat(core): per-attempt session threadId + stable idempotency key + real sessionId/runId in MessageResult + session-store mtime cache`
7b. `refactor(core): continuation as full re-dispatch (replaces context-dependent resume nudge)`
8. `feat(assets): register assets.saveFromSource hook`
9. `feat(core): session-death recovery ladder (salvage → corrective → decomposition → block)` — the behavioral core; depends on 2–8.
10. `feat(core): concurrent dispatch — in-flight turn registry, global/per-agent caps, settle-time reconciliation, scan-scoped lock` — includes the dispatched[] cap fix and kick-interleaving.
11. `fix(core): dependency-stranding guard (dependsOn → nonexistent task)`
12. `feat(tasks): session-death health check + audit query helper + create-checklist nudge`
13. `feat(core): output-discipline prompt rules + roster from runtime + shared tool-doc helper + sharpened orchestrator managed rules`
14. `test(dev): imitation-crab session-death/slow-turn/idle-timeout modes + live trajectory writes + e2e coverage (incl. concurrency)`
15. `docs(knowledge): session-forensics deep reference + dispatch/adapter doc updates + CLAUDE.md pattern`

## 10. Out of scope / follow-ups

- OpenClaw upstream fixes (max assistant message size, `assistant_output_too_large`, resumable interrupted sessions).
- Jessica/research agent-package SOUL.md + lessons updates in `bakin-bits-official` (separate repo task; the lesson should mirror the OUTPUT DISCIPLINE rule).
- Channel notifications on ladder transitions (declined for now; audit + health check chosen instead).
- **Rig validation item:** measure whether the OpenClaw gateway serializes concurrent turns per agent (dockerized rig, `bun run instance up`). Gates raising `maxTurnsPerAgent` above 1.
- **Rig validation item:** OpenClaw session retention behavior — does anything prune old sessions/sessions.json entries? Per-attempt sessions accumulate; if OpenClaw never prunes, raise upstream (we do not write `~/.openclaw`).
- **IO-efficiency cluster** → `.claude/specs/dispatch-io-efficiency.md` (follow-up spec): task-store in-memory index (full recursive scan per operation today), asset block via search index instead of all-sidecar scan, lesson-retrieval caching + truncation-cliff fix, chokidar/store double-broadcast on task writes, `task.moved` audit spam, watchdog vs restart-recovery 'manual' conflict, tool-catalog migration out of per-dispatch prompts.
