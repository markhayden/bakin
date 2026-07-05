# SPEC — Workflow Gate Approvals & Discord Notifications: E2E Validation + Hardening

Status: DRAFT — awaiting approval
Date: 2026-07-04
Owner: roscoe (single-user instance; no backwards-compatibility requirements)

## 1. Objective

Prove, on the live Bakin instance wired to the owner's Discord, that workflow
approval gates and their notifications work end-to-end — and fix the defects
that currently prevent that from being true. Deliver a reusable validation
harness (driver script + runbook) so the same proof can be re-run after any
future change.

### Defects already identified (root causes confirmed in code)

| # | Defect | Root cause |
|---|--------|-----------|
| D1 | Gate approval requests silently never reach Discord | `sendGateApprovalRequest` (`plugins/workflows/lib/notifications.ts:213,251`) passes the raw `approvalChannel` setting (`"approvals"`) to `runtime.channels.createApproval` with **no alias resolution** — only `bakin_exec_post_channel` resolves aliases via `resolveRuntimeChannelRef`. The adapter execs `openclaw message send --channel approvals`, which matches no OpenClaw channel; the failure is swallowed as a `warn` log. |
| D2 | Native Discord approve/reject buttons never used | `createApproval` (`packages/adapter-openclaw/src/runtime.ts:538-541`) skips the native path whenever the gate context has `requireRejectReason: true` — the live setting. All gates degrade to a rendered message + fallback link. |
| D3 | Stale approval debris accumulates forever | Three records from 2026-05 in `~/.bakin/workflows/approvals/`; rehydration logs `pending: 1, reattached: 0, skipped: 1` on every boot. No expiry/GC exists in the approval store. |

## 2. User Stories & Acceptance Criteria

All stories run against the **live instance** using the **real templates**
`text-social-post-copy` (user-owned) and `image-social-post` (plugin-shipped),
with real agents and real Discord delivery to the dedicated approvals channel.

### US1 — Gate reached → Discord approval request arrives
As the owner, when a workflow task hits an approval gate, I receive an
approval request in my dedicated Discord approvals channel.

- AC1.1 Gate step enters `pending_approval`; board task moves to review column.
- AC1.2 A Discord message arrives in channel `1492642521728290816` with the
  gate title, task/step identity, prior step output, and a working Bakin
  fallback decision link.
- AC1.3 A durable approval record exists under `~/.bakin/workflows/approvals/`
  with delivery refs recorded.
- AC1.4 Delivery works because `"approvals"` resolved through
  `notifications.channelAliases.approvals` → `discord:1492642521728290816`
  (D1 fixed; same resolver as `post-channel`).

### US2 — Approve via native Discord button → workflow advances
As the owner, I click **Approve** on the Discord message and the workflow
advances without touching the Bakin UI.

- AC2.1 Native buttons render on the Discord approval message even though
  `requireRejectReason: true` (D2 fixed — see §4 behavior change).
- AC2.2 Clicking Approve advances the workflow to the next step within one
  dispatch cycle; step state and audit (`gate.approved`) record a Discord
  actor identity.
- AC2.3 The original Discord approval is resolved/updated and a decision
  summary is posted (`resolveGateApproval` + `sendGateDecisionSummary`).

### US3 — Reject via Discord → default reason, rewind, revise, re-approve
As the owner, I click **Reject** on the Discord message; the gate records a
default reason, the workflow rewinds per `on_reject.goto`, the agent revises,
and the gate re-fires.

- AC3.1 A native-button reject with no structured reason records the default
  reason `Rejected via Discord (no reason provided)` — it is NOT blocked by
  `requireRejectReason` (behavior change, §4).
- AC3.2 `on_reject: { goto: write-copy, note_to_agent: true }` rewinds to the
  copy step and the reject reason reaches the agent's corrective prompt.
- AC3.3 The revised output re-triggers the gate; a fresh Discord approval
  request arrives (new approval record, new message).
- AC3.4 A reject via the **fallback decision page** with a typed reason still
  works and carries the typed reason (requireRejectReason enforced on
  surfaces that can collect one).

### US4 — Approve from the Bakin UI → Discord mirrors the decision
As the owner, when I approve a pending gate from the Bakin web UI, the
Discord approval message is resolved and a decision summary posts.

- AC4.1 `POST /gates/:taskId/approve` advances the workflow.
- AC4.2 The pending Discord approval is resolved (native) or a summary posts
  (render-only); no orphaned "pending" message remains actionable.

### US5 — Nested-gate flow (image-social-post)
As the owner, gates inside the nested image-generation workflow notify and
resolve identically to top-level gates.

- AC5.1 The nested workflow's gate(s) produce Discord approval requests with
  correct workflow/step identity.
- AC5.2 Approvals advance the nested instance and, on completion, the parent
  resumes; final publish posts the image to the `general` channel.

### US6 — Publish step completes the e2e story
- AC6.1 At least one run per template publishes real content to Discord via
  `bakin_exec_post_channel` and the workflow completes.
- AC6.2 Test posts, test tasks, workflow instances, and billed assets are
  cleaned up afterward (documented in the runbook; Discord deletes are
  manual).

### US7 — Approval store hygiene (D3)
- AC7.1 The stuck `pending:1/skipped:1` record is diagnosed and its failure
  mode documented.
- AC7.2 Approval-store GC prunes (a) resolved records older than 30 days and
  (b) pending records whose workflow instance no longer exists or is no
  longer pending on that step, older than 7 days. GC runs during startup
  rehydration; prunes are logged with counts.
- AC7.3 After validation, `~/.bakin/workflows/approvals/` contains only
  legitimately pending/current records and rehydration logs are clean.

## 3. Scope

### In scope (code changes)
1. **C1 — Unify channel resolution (D1):** gate approval delivery
   (`sendGateApprovalRequest`, `sendGateDecisionSummary`) resolves its channel
   through `resolveRuntimeChannelRef` before calling `runtime.channels.*`.
   Resolution failure logs at `error` (not `warn`) — silent delivery loss was
   the sting of D1.
2. **C2 — Native buttons + default reject reason (D2):** remove the
   `!requiresRejectReason(context)` guard on the native-approval path; channel
   rejects lacking a reason get the default reason
   `Rejected via Discord (no reason provided)` in
   `plugins/workflows/lib/channel-approvals.ts` (replacing the current
   reject-blocked-without-reason behavior). `requireRejectReason` continues to
   require a typed reason on the Bakin UI and fallback decision page.
3. **C3 — Approval-store GC (D3):** expiry rules per AC7.2, wired into
   `approval-rehydration.ts`.
4. **C4 — Validation harness:** `scripts/validate-gates.ts` driver +
   `docs/validation/gate-discord-runbook.md`. The script drives scenarios
   against the live server: creates workflow tasks, polls
   `/gates/pending`/instance state, verifies approval records + delivery
   refs, pauses with "click X in Discord now" prompts at interactive points,
   and prints a pass/fail report per acceptance criterion.
5. **C5 — Config:** live `settings.json` gains
   `notifications.channelAliases.approvals = "discord:1492642521728290816"`;
   workflows plugin settings keep `approvalChannel: "approvals"`,
   `approvalChannelAlerts: true`, `requireRejectReason: true`.

### In scope (validation run)
- Live interactive session (owner clicks Discord buttons/links): US1–US6
  scenario matrix, both button and fallback-page decision paths.
- Cleanup: test tasks archived/deleted, test Discord posts deleted (manual),
  billed image assets removed, approvals dir left clean.

### Out of scope
- Server-restart/rehydration live scenario (explicitly declined).
- video-social-post template.
- Purpose-built synthetic test workflows (real templates only).
- Any backwards-compatibility shims — this machine is the only user.
- CLI gate-approval command; Slack/Telegram/other providers.

## 4. Behavior Change (deliberate, owner-approved)

`requireRejectReason: true` no longer suppresses native channel approval
buttons. New semantics: **the reason requirement binds only surfaces capable
of collecting a reason** (Bakin UI, fallback decision page). Channel button
rejects auto-fill the default reason. The
`REJECT_REASON_APPROVAL_NOTICE` copy in
`packages/adapter-openclaw/src/channel-helpers.ts` and the
`channelRequiresBakinFallbackForReject` logic are updated/removed
accordingly; affected existing tests are rewritten to the new contract, not
preserved.

## 5. Commands

```bash
# build/test (existing)
bun run test                      # full suite (CI-equivalent)
bun test tests/path --isolate     # single file
bun run dev                       # dev loop (client-side watch only)

# harness (new)
bun scripts/validate-gates.ts --scenario us1        # one scenario
bun scripts/validate-gates.ts --all                 # full matrix
bun scripts/validate-gates.ts --all --report out.md # write report
```

## 6. Project Structure (touched surfaces)

```
plugins/workflows/lib/notifications.ts        # C1 — resolve alias before createApproval/sendNotification
plugins/workflows/lib/channel-approvals.ts    # C2 — default reject reason for channel rejects
plugins/workflows/lib/approval-store.ts       # C3 — GC verbs (listExpired, prune)
plugins/workflows/lib/approval-rehydration.ts # C3 — GC invocation at startup
packages/adapter-openclaw/src/runtime.ts      # C2 — drop requireRejectReason guard on native path
packages/adapter-openclaw/src/channel-helpers.ts # C2 — notice copy update
scripts/validate-gates.ts                     # C4 — driver
docs/validation/gate-discord-runbook.md       # C4 — runbook
tests/plugins/workflows/*                     # updated + new coverage
tests/adapter-openclaw/runtime-channels.test.ts # rewritten native-path expectations
.claude/knowledge/workflows-plugin.md         # docs: gate approvals section update
```

## 7. Testing Strategy

- **Mocked integration tests (repo, permanent):**
  - C1: gate notifier resolves `approvals` via `channelAliases`; unresolvable
    alias logs error and creates no delivery; resolved `discord:<id>` reaches
    the fake runtime's `createApproval`.
  - C2: native approval attempted when channel supports it regardless of
    `requireRejectReason`; channel reject without reason lands `rejectGate`
    with the default reason; fallback-page reject still requires a typed
    reason.
  - C3: GC prunes per AC7.2 rules; pending-and-current records survive.
  - All tests follow the repo's non-negotiable mock rules (content-dir both
    paths, OpenClaw home, logger, temp dirs, cleanup).
- **Live validation (harness-driven, interactive):** US1–US6 with the owner
  clicking Discord. The harness verifies machine-checkable ACs; human-visible
  ACs (message appearance, button render) are confirmed via y/n prompts and
  recorded in the report.

## 8. Commit Strategy (natural rollback checkpoints)

Branch: `feat/gate-discord-validation` off `main`. One commit per concern,
each independently revertible, tests green at every checkpoint:

1. `fix(workflows): resolve channel aliases in gate approval delivery` (C1 + tests)
2. `feat(workflows): native channel approvals with default reject reason` (C2 + tests, includes adapter change)
3. `feat(workflows): approval store GC for stale records` (C3 + tests)
4. `feat(scripts): gate/Discord e2e validation harness + runbook` (C4)
5. `docs(knowledge): update workflows-plugin gate approval semantics` (docs sweep: `.claude/knowledge/workflows-plugin.md`; README unaffected — verified during build)

Config change C5 is live-instance state, not repo state — applied during the
validation session and recorded in the runbook.

## 9. Boundaries

- **Always:** mock content-dir + OpenClaw home in every test; keep provider
  specifics behind the adapter boundary (the default-reason text lives in
  Bakin's workflows plugin, NOT the adapter — the adapter stays
  provider-mechanical); log every swallowed delivery failure.
- **Ask first:** deleting anything from Discord; touching
  `~/.openclaw/` config; any spend beyond the agreed template runs (extra
  image generations, video template).
- **Never:** write test data to real `~/.bakin/` or `~/.openclaw/` from the
  test suite; add a second channel-resolution path; fabricate validation
  results — every AC in the report links to observed evidence (log line,
  approval record, HTTP response, or owner confirmation).

## 10. Open Items Carried to Planning

- Exact GC thresholds (30d resolved / 7d orphaned) — confirm at plan review.
- Whether `sendGateDecisionSummary` should also post to the approvals channel
  (currently same channel as the request — keep).
- Diagnosis of the specific stuck May record happens during build; if it
  reveals a distinct bug, it becomes its own commit.
