# Session-Death Hardening — Implementation Plan

**Spec:** `.claude/specs/session-death-hardening.md` (approved 2026-06-04)
**Follow-up spec (not this plan):** `.claude/specs/dispatch-io-efficiency.md`

## Context

Production incident: research agent emitted 500–700KB completions in one turn → OpenClaw session died `interrupted` → Bakin reported a generic gateway timeout and blocked the task after burning two identical dispatch cycles. Four pillars: **detection** (trajectory forensics, fail-fast), **recovery** (salvage → corrective → decomposition → block), **prevention** (output-discipline prompts, orchestrator rules), **concurrency** (per-attempt sessions + bounded-parallel dispatch). Plus audit findings folded in: typed error classification, stream-leak fix, dead-surface deletion, continuation rewrite.

## Dependency graph

```
P1 dead-surface deletion ─┐
P2 typed error contracts ─┼─→ P3 adapter error mapping + dispatch classification
                          │        │
                          │        ├─→ P4 stream-leak fix (independent, same files)
                          │        │
                          │        └─→ P5 forensics parser ─→ P6 fail-fast detection
                          │                                        │
P7 per-dispatch sessions ─┴───────────────────────────────────────┤
   (threadId d<seq>, idempotency key, MessageResult ids,          │
    session-store cache)                                          │
        │                                                         │
        ├─→ P8 continuation-as-redispatch                         │
        │                                                         │
P9 assets.saveFromSource hook ──────────────────────┐             │
                                                    ▼             ▼
                                          P10 recovery ladder (salvage → corrective
                                              → decomposition → block; workflow variant)
                                                    │
                                          P11 concurrent dispatch (registry, caps,
                                              scan-scoped lock, dispatched[] cap fix)
                                                    │
P12 dependency-stranding guard (independent) ───────┤
                                                    ▼
                                          P13 reporting (audit kinds, queryAuditEvents,
                                              health check, create-nudge)
                                                    │
                                          P14 prevention prompts (OUTPUT DISCIPLINE,
                                              roster, shared tool-doc helper,
                                              orchestrator rules)
                                                    │
                                          P15 imitation-crab modes + e2e
                                                    │
                                          P16 docs + knowledge updates
```

P1/P2 are parallel-safe. P4, P12 are independent and can land any time after their file-neighbors stabilize. Checkpoints (full suite green + manual verify) after P3, P6, P10, P11, P15.

## Tasks

Each task = one commit from spec §9 (numbering kept aligned). Acceptance criteria (AC) are binary. Verification = `bun run test` green + the listed specific checks. **All new tests follow the CLAUDE.md testing rules** (mock both content-dir resolvers + OpenClaw home, temp dirs, `afterAll` cleanup, `--isolate`).

---

### P1 — Delete dead runtime-adapter surface
**Commit:** `refactor(core): delete dead runtime-adapter surface (tasks.*, agents.heartbeat, channels.on*, tools.list)`
**Files:** `packages/core/src/adapters/runtime/concepts.ts`, `packages/adapter-openclaw/src/runtime.ts`, `packages/core/src/adapters/plugin-context-services.ts`, `plugin-permissions.ts`, imitation-crab stubs, any tests referencing them.
**AC:**
- [ ] `AgentRuntimeAdapter` no longer declares `tasks.*`, `agents.heartbeat`, `channels.onMessage`, `channels.onInteraction`, `tools.list`.
- [ ] Grep proves zero remaining references (`rg 'runtime\.tasks\.|agents\.heartbeat|onMessage|onInteraction|tools\.list'` over src/, plugins/, packages/ — only unrelated hits).
- [ ] `bun run build` + full suite green.
**Verify:** typecheck catches any missed consumer; architecture tests still pass.

### P2 — Typed error + diagnosis contracts
**Commit:** `feat(core): RuntimeError/RuntimeErrorKind + RuntimeTurnDiagnosis contracts + oversized-output settings`
**Files:** `packages/core/src/adapters/runtime/concepts.ts` (or a sibling `errors.ts`), `packages/core/src/settings.ts`.
**AC:**
- [ ] `RuntimeError` (kind: `transport | timeout | session_death | provider_cooldown | runtime_failed`, `cause` always preserved) and `RuntimeTurnError extends RuntimeError` (kind `session_death`, carries `RuntimeTurnDiagnosis`) exported from `@bakin/core`.
- [ ] `RuntimeTurnDiagnosis` shape per spec §3.1 (reason, sessionId, sessionStatus, timedOut, completionBytes, outputTruncated, oversizedOutput, lastToolCall, salvagedText, usage, detail).
- [ ] `settings.dispatch.oversizedOutputBytes` (default 131072), `maxConcurrentTurns` (3), `maxTurnsPerAgent` (1) in settings schema + defaults; Zod-validated.
- [ ] Types only — zero behavior change; suite green untouched.

### P3 — Adapter error mapping + kind-based dispatch classification
**Commit:** `refactor(adapter-openclaw): typed error mapping with cause preserved; kind-based classification in dispatch (delete all substring matching)`
**Files:** `packages/adapter-openclaw/src/gateway-rpc.ts`, `runtime.ts`, `src/core/dispatch.ts`.
**AC:**
- [ ] Every adapter failure path throws `RuntimeError` with correct kind: RPC timeout→`timeout`; socket error/disconnect/not-connected/fetch-fail→`transport`; provider cooldown/auth strings→`provider_cooldown` (mapping the provider's strings happens ONCE, inside the adapter); CLI/HTTP-status failures→`runtime_failed`. `cause` carries the original error.
- [ ] `runOpenClawAgentGateway` no longer wraps with bare `new Error(...)` — C1 fixed: a simulated `ECONNRESET` classifies as **transient** in dispatch.
- [ ] `classifyDispatchError` / `classifyDispatchFailureDetail` operate on `instanceof RuntimeError` + `kind` only. **All** error-message substring matching deleted from `dispatch.ts`.
- [ ] New architecture test: `dispatch.ts` source contains no `.includes(` against error messages (allowlist for non-error uses).
- [ ] Test matrix: each kind → expected cooldown class / block behavior (`tests/core/dispatch-error-classification.test.ts`).
- [ ] Redundant double connect timer removed (one 5s timer remains).
**CHECKPOINT 1:** full suite + `bun run dev:mock` boots, mock error mode classifies as transport (not structural).

### P4 — Stream-leak fix
**Commit:** `fix(adapter-openclaw): mergeChatStreams try/finally — abort activity poller on early consumer break`
**AC:**
- [ ] `mergeChatStreams` aborts `stopSecondary()` via `finally` when the consumer breaks early.
- [ ] Test: start a stream against a temp session file, break after first chunk, assert poll loop stops (no file reads after generator return — spy on fs or poll-tick counter).

### P5 — Trajectory forensics parser + post-mortem
**Commit:** `feat(adapter-openclaw): trajectory forensics parser + post-mortem diagnosis`
**Files:** new `packages/adapter-openclaw/src/trajectory-forensics.ts`, `runtime.ts` (timeout catch path), test fixtures.
**AC:**
- [ ] `diagnoseSessionDeath(trajectoryPath, sinceByteOffset)` classifies from `session.ended.data.status` + preceding `model.completed`; computes `completionBytes` from `assistantTexts`; flags `oversizedOutput` against the threshold; extracts `lastToolCall` from the sibling session `.jsonl`; caps `salvagedText` at 262,144 bytes.
- [ ] Tolerant: malformed lines / unknown event types / missing file → `null` or partial diagnosis, never throws.
- [ ] On transport-timeout in `runOpenClawAgentGateway` with a known session, post-mortem runs; evidence → `RuntimeTurnError`, no evidence → original timeout error unchanged.
- [ ] Fixtures modeled on the real incident (oversized interrupted, clean success, interrupted-small, timed-out, malformed) under `tests/adapter-openclaw/fixtures/`.

### P6 — Fail-fast session-death detection
**Commit:** `feat(adapter-openclaw): fail-fast session-death detection during pending turns`
**AC:**
- [ ] While the agent RPC is pending (threadId known), the trajectory watcher detects `session.ended` with non-success status for this turn and rejects immediately with `RuntimeTurnError`; transport timer cancelled; no unhandled rejection.
- [ ] Detection latency under test ≤ 2 poll intervals (~400ms) from the event being written.
- [ ] Timer-fires-first race: post-mortem path (P5) still produces the same diagnosis — test both orderings.
**CHECKPOINT 2:** integration test — simulated dying session yields diagnosis in <1s vs the old 630s.

### P7 — Per-dispatch sessions + identity plumbing
**Commit:** `feat(core): per-attempt session threadId + stable idempotency key + real sessionId/runId in MessageResult + session-store mtime cache`
**Files:** `src/core/dispatch.ts`, `packages/adapter-openclaw/src/runtime.ts`.
**AC:**
- [ ] `.dispatch-state.json` gains monotonic per-task `dispatchSeq`; threadIds: `task:<id>:d<seq>` (regular), `task:<id>:step:<stepId>:d<seq>` (workflow). Sequence increments on every send; **never derived from failure count** (collision bug — see plan §double-checks).
- [ ] All three dispatch paths pass threadId. Notification/conversational callers (`task-service.ts:370`, `watchdog.ts:104`, `doctor.ts:102`, `agents.ts:75`) verified unchanged (explicit test asserting no threadId).
- [ ] Adapter `idempotencyKey` = `bakin:<threadId>` when threadId present, random otherwise.
- [ ] `messaging.send` returns real ids: `{ id: runId, metadata: { sessionId, runId } }`; dispatch records sessionId in the task log entry on dispatch.
- [ ] Session-store (`sessions.json`) reads go through an mtime-guarded cache.
- [ ] Two tasks to the same agent land in different provider sessions (mock asserts distinct sessionIds).

### P8 — Continuation as full re-dispatch
**Commit:** `refactor(core): continuation as full re-dispatch (replaces context-dependent resume nudge)`
**AC:**
- [ ] `continuation.ts` no longer sends the bare resume nudge; dependency completion routes the dependent task through the normal dispatch path (fresh `d<seq>` session, full self-contained prompt, completed-dependency summary + asset references included in the prompt context).
- [ ] No duplicate dispatch when the regular cycle also picks the task up (single-dispatch guard tested).

### P9 — assets.saveFromSource hook
**Commit:** `feat(assets): register assets.saveFromSource hook`
**AC:**
- [ ] Hook `assets.saveFromSource` registered in assets plugin `activate()`; input/output per spec §3.4; wraps `upsertFromSource`.
- [ ] Invocable from core via `getHookRegistry().invoke` (test via `tests/plugins/test-helpers.ts` `activatePlugin`).
- [ ] Re-invocation with same source path = version bump or no-op (idempotent), not a duplicate asset.

### P10 — Recovery ladder
**Commit:** `feat(core): session-death recovery ladder (salvage → corrective → decomposition → block)`
**Files:** `src/core/dispatch.ts` (reconciliation + prompt sections), `.dispatch-state.json` shape.
**AC:**
- [ ] `FailureRecord.sessionDeath` state per spec §3.5; session-death failures bypass generic cooldown/retry entirely.
- [ ] Death #1 → salvage (write `<contentDir>/tasks/salvage/<taskId>-d<seq>.md`, invoke hook, record assetId) → audit `task.runtime_session_died` → **immediate corrective re-dispatch from the settle handler** (via the single-task path, respecting concurrency caps — not parked for the next 5-min cycle), prompt opens with `PREVIOUS ATTEMPT FAILED` section (why it died, sizes, artifact-first steps, salvaged asset reference).
- [ ] Death #2 → salvage → audit → decomposition dispatch (do-not-do-the-work prompt: subtasks via `bakin_exec_tasks_create` + `parentId`, **chained sequentially via `set_dependency` (s2→s1, …); parent depends on the last subtask** — `dependsOn` is singular; **subtasks save deliverable assets against the PARENT taskId** so the parent's re-dispatch prompt lists them; reference salvaged assets, then stop) → audit `task.decomposition_dispatched`.
- [ ] Transport-failure retries (`kind: 'transport'`) run a **pre-retry forensics check** on the prior attempt's session: if it shows the turn completed (`session.ended` success / completion tool called), skip the resend and reconcile instead; residual mid-flight risk accepted + logged.
- [ ] Death #3 → block; `blockedReason` = full human-readable diagnosis + salvaged asset id + manual next-step guidance; audit `task.runtime_failed_blocked` carries structured diagnosis.
- [ ] **Workflow-step variant:** corrective re-dispatch once, then block — no decomposition rung.
- [ ] Generic (non-session-death) failures behave exactly as before (regression tests).
- [ ] Every transition adds a structured task-log entry.
**CHECKPOINT 3:** scripted walkthrough against mock — three consecutive deaths produce: salvaged assets ×3, corrective prompt, decomposition prompt, final block with diagnosis. The incident's red-herring string can no longer occur for a diagnosed death.

### P11 — Concurrent dispatch
**Commit:** `feat(core): concurrent dispatch — in-flight turn registry, global/per-agent caps, settle-time reconciliation, scan-scoped lock`
**AC:**
- [ ] In-flight registry per spec §3.8; cycle fires sends and returns; reconciliation in settle handlers (success / RuntimeTurnError ladder / generic cooldown) with task snapshot captured at fire time.
- [ ] Caps respected: global `maxConcurrentTurns`, per-agent `maxTurnsPerAgent`; over-cap tasks skipped with `agent_busy`/`concurrency_cap` ineligibility (no failure recorded).
- [ ] Slow send to agent A does not delay dispatch to agent B (timing test with mock delays).
- [ ] State lock only wraps state load/save; manual kick (`dispatchSingleTask`) interleaves with an in-flight cycle (test).
- [ ] `dispatched[]` cap honored via shared helper on both paths (`maxDispatched` setting respected — the 500-vs-200 bug fixed).
- [ ] No double-dispatch of one task across overlapping cycles (registry + dispatchedSet guard test).
- [ ] Watchdog/restart-recovery behavior unchanged (regression tests).
**CHECKPOINT 4:** mock-rig run — 3 tasks, 2 agents, one slow turn: all three progress independently; kick works mid-cycle.

### P12 — Dependency-stranding guard
**Commit:** `fix(core): dependency-stranding guard (dependsOn → nonexistent task)`
**AC:**
- [ ] `dependsOn` → id absent from every column ⇒ dependency treated satisfied + task-log note + log warning.
- [ ] Existing dependency gating (done/archived) unchanged.

### P13 — Reporting: audit, health check, nudge
**Commit:** `feat(tasks): session-death health check + audit query helper + create-checklist nudge`
**AC:**
- [ ] `queryAuditEvents(contentDir, { kinds, sinceMs })` in `src/core/audit.ts` with tests.
- [ ] Health check `session-death-incidents` registered by tasks plugin: warn when ≥1 `task.runtime_session_died` in 24h, listing taskId/agent/bytes; ok otherwise. Surfaces in `bakin doctor`.
- [ ] `bakin_exec_tasks_create` advisory nudge when description enumerates ≥3 deliverables without checklist structure; result-only, never rejects (tests for both shapes).

### P14 — Prevention prompts + rules
**Commit:** `feat(core): output-discipline prompt rules + roster from runtime + shared tool-doc helper + sharpened orchestrator managed rules`
**AC:**
- [ ] `OUTPUT DISCIPLINE — MANDATORY` section in BOTH builders per spec §3.7 (artifact-first >8KB, checklist-in-succession, short chat output, subtask option).
- [ ] Triage roster derived from `runtime.agents.list()`; hardcoded names gone (grep-proof).
- [ ] Shared tool-doc helper; both builders consume it; intentional differences (e.g. `post_channel` gating) explicit parameters, not drift.
- [ ] `_port` dead params removed from both builders + call sites.
- [ ] Orchestrator managed rules sharpened per spec §3.7 (checklist semantics for multi-deliverable tasks).
- [ ] Prompt snapshot tests: regular, workflow, corrective, decomposition variants.

### P15 — Mock fidelity + e2e
**Commit:** `test(dev): imitation-crab session-death/slow-turn/idle-timeout modes + live trajectory writes + e2e coverage`
**AC:**
- [ ] Mock gateway chat modes: `session-death` (writes `model.completed` oversized + `session.ended` interrupted to a live trajectory file, never sends final frame), `slow` (configurable delay), `idle-timeout` (turn_completion-shaped structured error). Mode selectable per agent/request.
- [ ] Mock writes live session JSONL + trajectory during turns (tool-call records → activity streaming exercised).
- [ ] E2e: full ladder against the mock (CHECKPOINT 3 scenario automated); concurrency scenario (CHECKPOINT 4) automated.
**CHECKPOINT 5:** `bun run test` + `bun run dev:mock` manual smoke: dispatch a task in session-death mode, watch diagnosis + ladder in UI/audit.

### P16 — Docs
**Commit:** `docs(knowledge): session-forensics deep reference + dispatch/adapter doc updates + CLAUDE.md pattern`
**AC:**
- [ ] New `.claude/knowledge/session-forensics.md` (trajectory schema, diagnosis flow, ladder, threadId scheme, salvage).
- [ ] `.claude/knowledge/dispatch.md` updated: typed classification, ladder, concurrency model, per-dispatch sessions, continuation change.
- [ ] `.claude/knowledge/adapter-architecture.md`: RuntimeError contract, MessageResult identity, caller classification table, deleted surface.
- [ ] `.claude/knowledge/dev-loop.md` / imitation-crab docs: new mock modes.
- [ ] CLAUDE.md: Key Patterns line for session forensics + concurrency caps; Architecture agents-bullet updated if needed. README checked (no dispatch internals there — verify).
- [ ] `.claude/specs/session-death-hardening.md` status flipped to Implemented.

## Double-checks already performed (do not re-litigate during build)

0. **User-story walkthrough resolutions (2026-06-04):** immediate corrective re-dispatch from settle (no 5-min wait); subtask chaining via singular `dependsOn` with parent on the last link; decomposition subtasks save assets against the parent taskId; pre-retry forensics check on transport failures.
1. **Attempt-counter collision** → monotonic `dispatchSeq` (failure count resets on success; would resume stale sessions).
2. **Workflow steps don't decompose** → corrective-then-block variant.
3. **Workflow threadIds include stepId** → parallel step agents can't collide.
4. **Caller classification** → only task-work sends get threadIds; notifications stay in default sessions.
5. **Continuation nudge depends on shared-session history** → becomes full re-dispatch (P8).
6. **Trajectory is the `.trajectory.jsonl` sibling**, not the `.jsonl` the adapter already tails — forensics reads both (trajectory for lifecycle events, session file for lastToolCall).
7. **Salvage crosses the boundary in-memory** (diagnosis.salvagedText), written by core, saved via hook — adapter never touches `~/.bakin`, core never touches `~/.openclaw`.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| OpenClaw gateway may serialize turns per agent internally | per-agent cap defaults to 1; rig validation before raising |
| Per-dispatch sessions accumulate in `~/.openclaw` | mtime-cached lookups now; retention is upstream (rig validation item); monitor via health surface later |
| Forensics schema drift (schemaVersion > 1) | parser checks `traceSchema`/`schemaVersion`, degrades to generic timeout on mismatch |
| Concurrency exposes latent task-store races | caps small by default; store-level IO work deliberately deferred to dispatch-io-efficiency spec; regression suite on watchdog/recovery |
| Corrective prompt still ignored by model | ladder caps damage at 3 turns; decomposition rung is structurally tiny-output; block reason is actionable |

## Execution order

P1 → P2 → P3 ✋CP1 → P4 → P5 → P6 ✋CP2 → P7 → P8 → P9 → P10 ✋CP3 → P11 ✋CP4 → P12 → P13 → P14 → P15 ✋CP5 → P16

Branch: `feat/session-death-hardening` off `main`. One commit per task (P7 includes the 7b continuation prep only if inseparable; otherwise P8 is its own commit). PR at the end referencing the incident task + this plan.
