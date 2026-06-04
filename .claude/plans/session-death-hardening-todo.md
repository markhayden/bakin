# Session-Death Hardening — Task Checklist

Plan: `.claude/plans/session-death-hardening.md` · Spec: `.claude/specs/session-death-hardening.md`
Branch: `feat/session-death-hardening`

- [ ] P1 `refactor(core)`: delete dead runtime-adapter surface (tasks.*, agents.heartbeat, channels.on*, tools.list)
- [ ] P2 `feat(core)`: RuntimeError/RuntimeErrorKind + RuntimeTurnDiagnosis contracts + dispatch settings (oversizedOutputBytes, maxConcurrentTurns, maxTurnsPerAgent)
- [ ] P3 `refactor(adapter-openclaw)`: typed error mapping w/ cause; kind-based classification in dispatch; delete ALL substring matching; architecture test
- [ ] ✋ CHECKPOINT 1 — suite green, mock error mode → transient
- [ ] P4 `fix(adapter-openclaw)`: mergeChatStreams try/finally poller-leak fix
- [ ] P5 `feat(adapter-openclaw)`: trajectory-forensics parser + post-mortem diagnosis + incident fixtures
- [ ] P6 `feat(adapter-openclaw)`: fail-fast session-death detection during pending turns
- [ ] ✋ CHECKPOINT 2 — dying session diagnosed <1s (vs 630s)
- [ ] P7 `feat(core)`: per-dispatch sessions (task:<id>:d<seq> / step variant), stable idempotency key, real sessionId/runId in MessageResult, session-store mtime cache
- [ ] P8 `refactor(core)`: continuation as full re-dispatch
- [ ] P9 `feat(assets)`: assets.saveFromSource hook
- [ ] P10 `feat(core)`: recovery ladder — salvage → corrective → decomposition → block (+ workflow corrective-then-block variant)
- [ ] ✋ CHECKPOINT 3 — 3 deaths → salvage ×3, corrective, decomposition, diagnostic block
- [ ] P11 `feat(core)`: concurrent dispatch — registry, caps, settle reconciliation, scan-scoped lock, dispatched[] cap fix
- [ ] ✋ CHECKPOINT 4 — independent progress across agents; kick interleaves
- [ ] P12 `fix(core)`: dependency-stranding guard
- [ ] P13 `feat(tasks)`: queryAuditEvents + session-death health check + create-checklist nudge
- [ ] P14 `feat(core)`: OUTPUT DISCIPLINE prompts, roster from runtime, shared tool-doc helper, orchestrator rules
- [ ] P15 `test(dev)`: imitation-crab session-death/slow/idle-timeout modes + live trajectory writes + e2e
- [ ] ✋ CHECKPOINT 5 — full suite + dev:mock smoke of ladder in UI/audit
- [ ] P16 `docs(knowledge)`: session-forensics.md + dispatch/adapter/dev-loop/CLAUDE.md updates; spec → Implemented

Follow-ups (NOT this branch): `.claude/specs/dispatch-io-efficiency.md` · jessica SOUL.md/lessons in bakin-bits-official · rig validation: gateway per-agent concurrency + session retention
