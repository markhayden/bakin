# Plan — Workflow Gate Approvals & Discord Notifications: E2E Validation + Hardening

Spec: `SPEC.md` (approved 2026-07-04). Branch: `feat/gate-discord-validation` off `main`.

## Context

Workflow gates should notify Discord and accept approve/reject decisions from there. Live evidence shows this has **never worked** on this instance — all three records in `~/.bakin/workflows/approvals/` have `deliveries: 0`, including the two gates that were approved (via the UI). Confirmed root causes:

- **D1** — `sendGateApprovalRequest` / `sendGateDecisionSummary` (`plugins/workflows/lib/notifications.ts:213,251,344`) pass the raw `approvalChannel` setting (`"approvals"`) to `runtime.channels.*` with **no alias resolution**; the OpenClaw exec fails on the unknown channel and is swallowed at `warn`. Only `bakin_exec_post_channel` resolves aliases (`resolveRuntimeChannelRef`, `src/core/channel-aliases.ts`).
- **D2** — `packages/adapter-openclaw/src/runtime.ts:540` skips native Discord buttons whenever the gate has `requireRejectReason: true` (the live setting) — even a correct channel yields link-only messages.
- **D3** — approval records never expire; `messaging-cf679f39` (2026-05-15) is orphaned-pending and logs `pending:1/skipped:1` on every boot.

Owner-approved behavior change: `requireRejectReason` binds only surfaces that can collect a reason (Bakin UI / fallback decision page); native channel-button rejects auto-fill a **provider-neutral** default reason.

The live server runs `bun run dev` from this working tree (pid via `~/.bakin/server.lock`), so deploying = restart the dev process on the branch.

## Dependency graph

```
T1 (C1 alias resolution) ──┐
T2 (C2 native buttons)  ──┼── independent of each other; all precede T6
T3 (C3 approval GC)     ──┘
T4 (C4 harness)         ── needs T1–T3 semantics to encode expected outcomes
T5 (docs sweep)         ── needs T1–T3 final behavior
T6 (deploy + config)    ── needs T1–T4 on branch
T7–T8 (live validation) ── needs T6; owner present to click Discord
T9 (cleanup + report)   ── needs T7–T8
```

## Phase A — Code hardening (each task = one commit, `bun run test` green at every checkpoint)

### T1 — `fix(workflows): resolve channel aliases in gate approval delivery` (C1)
Files: `plugins/workflows/lib/notifications.ts`, `plugins/workflows/lib/approval-rehydration.ts`.
- Import `resolveRuntimeChannelRef` via **relative** `../../../src/core/channel-aliases` (repo precedent: `plugins/health/lib/system-checks/channel-aliases.ts:5`; plugin→src/core is allowed by the architecture scanners).
- `sendGateApprovalRequest`: resolve **after** `createApprovalRecord` (durable record must exist for rehydration retry), own try/catch, `log.error('Gate approval channel resolution failed', …)` + `return null` on failure; pass `channels: [resolved.resolved]`.
- `sendGateDecisionSummary`: resolve before `sendNotification`, `log.error` + return on failure.
- `approval-rehydration.ts`: resolve `options.channel` **lazily** — once, cached, only when the first record actually needs re-render (eager resolution would error-log on every boot and break full-activation tests). On failure: `log?.error?.`, count `failed`, skip. Extend `ApprovalRehydrationLogger` with `error?`.
- Tests (rewrite + add): `tests/plugins/workflows/notifications.test.ts` — add `channels.list` to the runtime mock + dual settings/content-dir mocks (template: `tests/core/exec-tools/post-channel.test.ts:19-38`); new cases: alias resolves → `createApproval` gets `discord:123`; unresolvable → null return, no send, durable record still created, `log.error` asserted. `tests/plugins/workflows/approval-rehydration.test.ts` — re-render uses resolved id; resolution failure counts `failed`.
- AC: unresolvable channel = error log + no delivery + durable record intact; resolvable alias = delivery with resolved target.

### T2 — `feat(workflows): native channel approvals with default reject reason` (C2)
Files: `packages/adapter-openclaw/src/runtime.ts` (remove `&& !requiresRejectReason(context)` at :540 and the now-unused import at :75), `packages/adapter-openclaw/src/channel-helpers.ts` (update `REJECT_REASON_APPROVAL_NOTICE` copy to the new contract; fix stale `rejectReason: 'bakin-fallback-link'` metadata value), `plugins/workflows/lib/channel-approvals.ts` (delete the reject-ignored block at :86-97; keep line 98's default, amended to `'Rejected via runtime channel (no reason provided)'` — provider-neutral, adapter-boundary rule), `plugins/workflows/index.ts:54` (settings description copy).
- Keep sending `requireRejectReason` in the gate context (adapter still reads it for notice copy); fallback decision page (`routes/gates.ts`) already enforces typed reasons unconditionally — no change.
- Tests: `tests/adapter-openclaw/runtime-channels.test.ts` — invert the :251-290 block (requireRejectReason + interactive → native approval IS created); add native-creation-failure → fallback message carries the revised notice. **New** `tests/plugins/workflows/channel-approvals.test.ts` (first coverage of `wireChannelApprovals`): button reject with empty comment on a require-reason record → `rejectGate` with default reason; with comment → comment used; approve sanity. Use `createMockRuntimeAdapter` with captured `subscribeApprovalResponses` handler; full repo mock preamble.
- AC: buttons render regardless of `requireRejectReason`; button reject never blocked; typed-reason surfaces unchanged.

### T3 — `feat(workflows): approval store GC for stale records` (C3)
Files: `plugins/workflows/lib/approval-store.ts` (add `deleteApprovalRecord`, `pruneResolvedApprovalRecords(maxAgeMs)` — prune statuses `approved|rejected|cancelled|expired` by `resolvedAt ?? updatedAt`; `unlinkSync`), `plugins/workflows/lib/approval-rehydration.ts` (prune at top, 30-day threshold; cancel-as-orphaned via `cancelApprovalRecord` in exactly the malformed-owner and instance-mismatch skip branches — **never** the zero-deliveries live-gate branch; add `pruned`/`cancelled` to the summary), `plugins/workflows/lib/channel-approvals.ts:29-31` (widen the summary log gate so prune/cancel activity is visible).
- Consumer audit done: nothing outside approval-store/rehydration/gates-routes reads the approvals dir; pruning is safe. Known acceptable change: a >30-day-old fallback link renders 404 instead of "already decided".
- Tests: `approval-rehydration.test.ts` — update exact `toEqual` summaries; orphan-cancel cases (missing instance / runId mismatch / step moved on / not pending); negative case (live gate, renderMissingDeliveries=false → stays pending); prune cases (31d resolved deleted, 29d kept, pending never pruned regardless of age).
- AC: after one rehydration on live data, the May orphan is cancelled, the two >30d approved records are pruned, boot logs are clean.

### T4 — `feat(scripts): gate/Discord e2e validation harness + runbook` (C4)
Files: `scripts/validate-gates.ts` (new), `docs/validation/gate-discord-runbook.md` (new).
- Driver: scenario functions US1–US6 against `BAKIN_URL` (default `http://localhost:3737`). Creates tasks via `POST /api/plugins/tasks` with `workflowId` (same route as `bakin tasks create --workflow=`), polls `GET /api/plugins/workflows/gates/pending` + instance state, reads approval records under `~/.bakin/workflows/approvals/` for delivery-ref assertions, pauses with "click Approve/Reject in Discord now" prompts at interactive points, y/n confirms for human-visible ACs (message appearance/buttons), prints per-AC pass/fail and optional `--report <file>` markdown.
- Flags: `--scenario us1..us6`, `--all`, `--report`. No test-suite dependencies; plain Bun script.
- Runbook: prerequisites (settings, channel alias, dev server on branch, owner present), scenario table mapped to SPEC ACs, cleanup checklist (archive/delete test tasks, delete Discord posts manually, remove billed image assets, verify approvals dir).
- AC: `bun scripts/validate-gates.ts --scenario us1` runs end-to-end against the live server.

### T5 — `docs(knowledge): update gate approval semantics` 
Files: `.claude/knowledge/workflows-plugin.md` (§ Runtime Gate Approvals — alias resolution, new reject-reason contract, GC), `.claude/knowledge/workflow-approvals.md:57-65` (no-reason channel rejects no longer ignored), `docs/src/content/docs/using/workflows.md:46,87` (user-facing semantics + settings table). README check: gate internals aren't covered there — verify and note in commit body.
- AC: no doc still claims buttons are withheld when a reject reason is required.

**Checkpoint A:** full `bun run test` green; five commits on `feat/gate-discord-validation`; no changes outside the listed files (`git diff --stat` review).

## Phase B — Live deployment, validation, cleanup (interactive; owner present)

### T6 — Deploy branch + config (C5)
- Add `notifications.channelAliases.approvals = "discord:1492642521728290816"` to `~/.bakin/settings.json` (keep `approvalChannel: "approvals"`, `approvalChannelAlerts: true`, `requireRejectReason: true`).
- Restart the dev server on the branch (kill pid from `server.lock`, `bun run dev`, verify port 3737 + `bakin status`). Watch first-boot logs: expect the T3 GC to cancel the May orphan + prune the two old approved records.
- Verification: `curl /api/plugins/workflows/gates/status`; boot log shows clean rehydration summary.

### T7 — Live scenarios US1–US4 (text-social-post-copy)
Harness-driven, in order: US1 gate-reached delivery (Discord message in the approvals channel, deliveries persisted); US2 native-button approve (workflow advances, decision mirrored + summary); US3 button reject → default reason recorded → rewind to write-copy → agent revises → gate re-fires → fallback-page reject with typed reason → rewind again → approve; US4 Bakin-UI approve mirrors to Discord. First run publishes for real (US6 half 1).

### T8 — Live scenario US5 + US6 (image-social-post)
One run: nested image-workflow gate notifies with correct identity, approve via button, parent resumes, final publish posts the image. (Single run — image generation is billed.)

### T9 — Cleanup + report
- Archive/delete test tasks + workflow instances; delete test Discord posts (manual, owner); remove billed test assets; verify `~/.bakin/workflows/approvals/` holds only current records.
- Harness `--report` output saved to `docs/validation/` (or attached to the PR); each AC links to evidence (log line, approval record, HTTP response, or owner confirmation).
- Merge branch to main via PR after validation passes; delete `SPEC.md` working copy or fold outcomes into it per owner preference at the time.

**Checkpoint B:** all SPEC ACs pass or have a filed defect with diagnosis; live instance left on merged main with a restarted server and clean state.

## Hazards accepted / noted
- Fresh installs with no notifications settings will now error-log gate alerts instead of silently failing (intended visibility).
- Accidental Discord reject now rewinds with default reason (owner-approved design).
- Work happens in the same working tree the live dev server runs from — server behavior changes only at restart (T6), client bundles may hot-reload harmlessly before that.

## Verification summary
- Per-task: listed unit/integration tests + full suite at each commit.
- End-to-end: the harness run in T7/T8 is the verification of the whole effort; its report is the deliverable evidence.
