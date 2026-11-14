# Implementation Plan: Provider integrations (Google Workspace + GitHub)

Spec: `provider-integrations.md` rev 5 (signed off 2026-11-13). Plan **rev 3**
after two Codex reviews (rev 1: dependency order, task splits, test paths,
ledger constraint + retention, rollback honesty, grant funnel, UI composition;
rev 2: in-flight turn drain on rollback, grants-editor composition decided,
placeholders removed, `StartTurnResult` kept stable — every finding verified
against the source). Status marks are kept HERE.

## Overview

Four deliverables, each a reviewable checkpoint: **Bits PR** (packs),
**bakin PR1** (login verification), **bakin PR2** (task approval gate +
standing grants), **bakin PR3** (schedule chat target). PR2 stacks on PR1,
PR3 on PR2. The Bits PR runs beside PR1 and stays open until PR2 is
live-tested (its skills name PR2's tools). Mark live-tests W1 after Bits+PR1,
W2+W3 after PR2, W4 after PR3; I merge nothing.

## Architecture decisions (spec, not re-litigated)

D1 cooperative approval policy · D3 agent executes after approval · D5
visibility-only classes · D6 per-task standing grants · D7 gate in the tasks
plugin · D9 explicit login verification with receipts · D10 gog pinned from
upstream tar.gz · D11 one entry skill + vendored references · D13 chat target
with ledger-held admission identity.

## Branch, commit, gate and rollback strategy

| Repo | Branch | Base | Lands as |
|---|---|---|---|
| bakin | `feat/pack-login-verification` | `main` | PR1 |
| bakin | `feat/task-approval-gate` | PR1 branch | PR2 (retarget to main after PR1 merges) |
| bakin | `feat/schedule-chat-target` | PR2 branch | PR3 |
| bakin-bits-official | `feat/google-github-packs-v2` | `main` | Bits PR |

- Branches live in the main checkouts so 3737 serves them; server-side changes need a 3737 restart to test.
- **One task = one conventional commit**, each leaving lint, typecheck and the task's test files green — a bisectable checkpoint. Docs tasks are their own commits inside the PR.
- **No published-contract breaks:** `StartTurnResult`/`ConversationStartTurnResult` stay as they are (Bits plugins compare `=== 'accepted'`); every persisted change is additive.
- **Per-PR gate before "ready for review":** `bun run lint && bun run typecheck && bun run check:cycles`; the PR's test files `--isolate`; `bun run test` once; `bun run ui:conformance --quick` after each UI task and **`--full` before the PR is marked ready** (the conformance skill's merge-ready rule — every PR that touches UI, not only PR3); **≥2 Codex rounds** (`codex exec -s read-only`) fixed in-batch; then Mark's live test; then Mark merges/releases.
- Bits pack versions bump in the same PR (google-workspace 2.0.0, github 1.1.0); `bakin` floor = the rc that ships PR1.

**Rollback is a procedure, not a revert.** Reverting a merge commit restores code; it does not make state written by the feature safe for old code:

| PR | What old code does with the new state | Required quiescence BEFORE reverting | Verified by |
|---|---|---|---|
| PR1 | ignores receipts and `login`; a pack with `requires.login` parses (field dropped) and reads ready | none | — |
| PR2 | `approvedActions`/`grants` are preserved as unknown JSON; pending `tasks:` approvals become an unknown kind (503 on resolve, skipped at rehydration — never cancelled); installed skills still name `request_approval` | cancel or decide every pending `tasks:` approval; move blocked-awaiting tasks to todo; pause schedules carrying grants; re-install Bits packs at their previous version | `bakin approvals list --kind plugin-gate` empty; downgrade test: old gate-less build boots on a PR2 data dir without error |
| PR3 | old scheduler runs a `target: 'chat'` job as a TASK; old retention deletes `starting` rows; old run readers label `starting` as success; old chat parsing drops `turnId`/`admissionKey` and its interrupted sweep stamps without `turnId` | pause every chat-target job; wait until no `starting` row remains and every `created` chat run's turn has a terminal row (abort in-flight scheduled turns from the chat or let them settle — `bakin schedule runs` lists both); only then revert | downgrade test (3.2): a db with a settled PR3 history opens under the previous migration set; `starting` absent and no in-flight turn ⇒ no behavioural change |

Reverse dependency order always: PR3 → PR2 → PR1 → Bits.

## Dependency graph

```
PR1  1.1 bakin range → 1.2 schema+type → 1.3 engine → 1.4a readiness leg → 1.4b install/sync trigger → 1.4c HTTP/secret/CLI triggers
     → 1.5a Health → 1.5b Explore+hub → 1.5c CLI → 1.6 docs → GATE → W1 (needs Bits B1/B2 on disk)
Bits B1 manifest (needs 1.2) → B2a vendor tooling → B2b entry skill → B3 github (needs 1.2) → B4 contract test → B5 READMEs
PR2  2.3 harness → 2.4a gate state (constants) → 2.1a field+funnel → 2.1b REST+provenance → 2.1c CLI
     → 2.2a job grants+routes → 2.2b inheritance+exempt reason → 2.2c schedule CLI → 2.4b handler (needs 2.1a) → 2.5 tools
     → 2.6a prompt plumbing+main/triage → 2.6b specialist/workflow+fixtures → 2.7a approve-all + grants editor → 2.7b job-form grants
     → 2.8a docs (approvals/tasks/dispatch) → 2.8b docs (scheduler/provider overview) → GATE → W2+W3
PR3  3.2 ledger (rebuild+retention) → 3.1a chat row schema → 3.1b engine contract+callers → 3.1c sweep → 3.3a chat hooks → 3.3b badge
     → 3.4a job types+validation (chat REFUSED) → 3.4b fire path → 3.4c healer/crash → 3.4d catch-up/failure/readers
     → 3.4e routes accept chat + form + {fireAt} → 3.5 run history/job row → 3.6 docs → GATE (--full) → W4
```

Parallel-safe: the Bits PR beside PR1 (after 1.2); docs tasks beside the last code task of their PR. Everything else sequential.

---

## Phase 0 — Bits PR (`bakin-bits-official`)

### B1 — google-workspace 2.0.0 manifest
Pinned `gog` bin (four platforms from the spec table; `archive.member: gog`, `extractedSha256`, `verifyArgs: ['--version']`), `requires.login` with `accountEnv: 'GOG_ACCOUNT'`, drop `prereqs.gog`, `bakin` floor, version 2.0.0.
**Acceptance:** pins equal `checksums.txt` + the member hashes; the host schema (1.2) parses it — proven by a bakin test fixture that mirrors this manifest byte-for-byte (`tests/agent-packages/manifest.test.ts`, task 1.2) and by the live install (Checkpoint PR1).
**Verify:** `cd ../bakin-bits-official && bun run test`. **Deps:** 1.2. **Files:** `packs/google-workspace/bakin-package.json`. **Size:** S.

### B2a — vendor tooling
`scripts/vendor-gog-skills.ts <tag>`: fetch the eight `SKILL.md`s at the tag into `skills/google-workspace/references/<name>.md`, keep LICENSE, drop `agents/`, write `references/VENDORED.json { tag, sha, files }`. Run it for `v0.48.0` (the mechanical import is the one size exception — generated content, one commit, reviewed by diff).
**Acceptance:** re-running is idempotent; `VENDORED.json.tag` == `v` + `requires.bins[0].version`.
**Verify:** Bits tests (B4 adds the stamp check). **Deps:** B1. **Files:** `scripts/vendor-gog-skills.ts`, `packs/google-workspace/skills/google-workspace/references/**`. **Size:** S + generated.

### B2b — entry skill
Rewrite `skills/google-workspace/SKILL.md` per spec §4.2: fast path, read discipline, explicit account, the class table, chat (`ask_user`) vs task (`request_approval` → `approval_outcome attempting` → run → `approval_outcome done|failed|unknown`), assets discipline, honest failure, provider cautions, which reference to open when.
**Acceptance:** ≤ 6 KB; every reference it names exists; names every class in the spec table.
**Verify:** Bits tests; `bakin agents context` before/after recorded in the PR. **Deps:** B2a. **Files:** one. **Size:** S.

### B3 — github 1.1.0
`requires.login` (`gh auth status`), gh floor in prereq help, Rules section rewritten with classes + the two-call contract, Projects v2 cautions, GH_TOKEN identity note, version + floor.
**Deps:** 1.2. **Files:** `packs/github/{bakin-package.json,skills/github/SKILL.md}`. **Size:** S.

### B4 — pack contract test
`login` entries bind to `bins[].name` or binary `prereqs[].probe`, non-empty `setup`, https `help`, `accountEnv` shape; `VENDORED.json.tag` matches the bin version and every listed file exists; catalog unchanged.
**Deps:** B1–B3. **Files:** `packs/pack-contract.test.ts`. **Size:** S.

### B5 — READMEs
Google Cloud one-time setup (Internal consent for Workspace orgs), `GOG_ACCOUNT`, admin caveat; GitHub login note. **Deps:** none. **Size:** S.

### Checkpoint: Bits
- [ ] Bits suite green; the manifest fixture test in bakin green; pack installs on a `verify` boot (after PR1) and reads `login: missing` with the setup command.

---

## Phase 1 — PR1: login verification

### 1.1 — enforce the pack `bakin` range
Installer + upgrader refuse a pack whose `bakin` range the host version fails (`Bun.semver.satisfies`, prerelease-aware; `0.0.0-dev` satisfies all), typed `bakin_range_unsatisfied` naming both versions.
**Verify:** `bun test tests/agent-packages/installer.test.ts --isolate` (new cases). **Deps:** none. **Files:** `src/core/agent-packages/installer.ts` (+ upgrade path), test. **Size:** S.

### 1.2 — `requires.login[]` schema + SDK type
`LoginRequirementSchema` (name, probe argv, setup, help, accountEnv) with the binding refine (`bins[].name` / binary `prereqs[].probe`); `CapabilityLoginStatus` exported from the SDK types; public-api schema; a fixture mirroring the google-workspace 2.0.0 manifest parses.
**Verify:** `bun test tests/agent-packages/manifest.test.ts tests/ui/architecture/sdk-public-api.test.ts --isolate`. **Deps:** none. **Files:** `packages/core/src/agent-packages/manifest.ts`, SDK types file, `design-system/public-api.schema.json`, test + fixture. **Size:** S.

### 1.3 — login-verify engine + receipts
`src/core/agent-packages/login-verify.ts`: resolve (managed bin → verified path or `unknown`; prereq → PATH), `Bun.spawn` no shell, stdin closed, stdout/stderr capped at 16 KB and the cap persisted, 5 s kill, in-flight dedupe, classification, `accountEnv` match, receipt (status, checkedAt, exit, binaryPath+sha, packVersion, account, accountInputHash, secretSlotsHash) atomic write; `readLoginReceipt`, `isReceiptStale(receipt, current)` — stale on pack version / binary sha / accountInputHash / declared-secret change after `checkedAt`.
**Verify:** `bun test tests/agent-packages/login-verify.test.ts --isolate` (fake probes ok/missing/unknown, kill, bounded capture, account mismatch, every staleness cause). **Deps:** 1.2. **Files:** new module + test. **Size:** M.

### 1.4a — readiness `login` leg (read-only)
`capability-readiness.ts` reads receipts, applies staleness, blocks `ready` on `missing`/`unknown`, emits the two remediation strings; never spawns.
**Verify:** `bun test tests/agent-packages/capability-readiness.test.ts --isolate` (marker-file probe proves no spawn on read). **Deps:** 1.3. **Files:** `capability-readiness.ts`, test. **Size:** S.

### 1.4b — install/sync trigger + consent disclosure
Run the probe once at the end of `installManifestRequirements` (install and sync); consent preview lists `login` probes ("Bakin runs `<probe>` after install, on sync and on request").
**Verify:** `bun test tests/agent-packages/requirement-legs.test.ts tests/agent-packages/installer.test.ts --isolate` (exactly one probe per install). **Deps:** 1.4a. **Files:** `requirements-installer.ts`, consent builder, tests. **Size:** S.

### 1.4c — explicit triggers: HTTP, secret save, CLI
`POST /api/packages/:key/login-check`; `POST /api/secrets` re-probes packs declaring that slot; `bakin check capabilities` (the `recommended-capabilities` onboarding component) runs stale/unknown probes then reports; `bakin packages login-check <key>`.
**Verify:** `bun test tests/core/onboarding/recommended-capabilities.test.ts tests/api/packages-login-check.test.ts tests/api/secrets.test.ts --isolate`. **Deps:** 1.4a. **Files:** `packages/host/src/api/packages/login-check.ts` (new), `packages/host/src/api/secrets.ts`, `src/core/onboarding/recommended-capabilities.ts`, `src/cli/commands/packages.ts`, tests. **Size:** M.

### 1.5a — Health incident
`capabilities` check: `not-ready-login` (`human`, `needs: 'credential'`, handoff = setup, `request` choice → login-check route).
**Verify:** `bun test tests/plugins/health/capabilities-check.test.ts --isolate` (new file). **Deps:** 1.4c. **Files:** `plugins/health/lib/system-checks/capabilities.ts`, test. **Size:** S.

### 1.5b — Explore + runtime hub
Installed card states "Installed — needs login" / "Login not verified" with the setup command and a **Check login** button; the hub's Capabilities tab shows the leg row with the same button.
**Verify:** `bun test tests/plugins/explore/catalog-entry.test.tsx tests/plugins/explore/install-dialog.test.tsx tests/components/runtime-hub.test.tsx --isolate`; `bun run ui:conformance --quick`. **Deps:** 1.4c. **Files:** `plugins/explore/components/{catalog-entry,install-dialog}.tsx`, hub tab component, tests. **Size:** M.

### 1.5c — CLI presentation
`bakin check capabilities` prints status + age + setup; exit code reflects `missing`/`unknown`.
**Verify:** `bun test tests/cli/check-capabilities.test.ts --isolate`. **Deps:** 1.4c. **Size:** S.

### 1.6 — docs
`capability-packs.md` (login leg, receipts, triggers, staleness, bakin-range enforcement), `agent-packages.md`, `docs/…/extending/agents/packages.md`, CLAUDE.md line. **Size:** S.

### Checkpoint: PR1 (+ Bits on disk)
- [ ] Gate green (lint, typecheck, cycles, PR tests, full suite, conformance quick + full); ≥2 Codex rounds fixed.
- [ ] `verify` boot: install google-workspace from the local Bits checkout → `login: missing` + setup command; a receipt made stale by a pin change → `unknown`.
- [ ] Mark on 3737: installs via Explore, creates the OAuth client, runs setup, Check login → ok; **W1 passes** in chat.

---

## Phase 2 — PR2: task approval gate + standing grants

### 2.3 — plugin test harness gains approvals
`createTestContext` wires `createMemoryApprovalsBackend` + `createPluginApprovalsAPI` (as the SDK harness does) and exposes `decideApproval(id, option, comment?)`.
**Verify:** existing plugin tests green; smoke test. **Deps:** none. **Files:** `tests/plugins/test-helpers.ts`, test. **Size:** S.

### 2.4a — gate state (pure) + constants
`plugins/tasks/lib/approval-gate.ts`: `ACTION_CLASS_RE`, `AWAITING_APPROVAL_REASON`, `approvalIdFor`, `requestHash`, the per-task record `{ generation, current?, history[] }` with states `pending | applying | approved-unconsumed | attempting | consumed | rejected | cancelled`, pure transitions, `applyCommittedApproval` as a reducer (entry guards from `pending` vs `applying` per spec).
**Verify:** `bun test tests/plugins/tasks/approval-gate-state.test.ts --isolate`. **Deps:** 2.3. **Size:** M.

### 2.1a — `approvedActions` field + creation funnel
`Task`/`TaskCreateInput`/`TaskUpdateInput` (null clears), store schema, `public-task` patch, **`createTaskWithEffects` input + forwarding** and the stored-task create path; `ctx.tasks` (PluginTaskService) strips/refuses the field (plugins have no request provenance).
**Verify:** `bun test tests/core/task-service.test.ts tests/plugins/tasks/integration.test.ts --isolate`. **Deps:** 2.4a. **Files:** `packages/sdk/src/types/services.ts`, `packages/core/src/tasks/{store,public-task}.ts`, `src/core/task-service.ts`, `src/lib/plugin-context-services.ts`, tests. **Size:** M.

### 2.1b — REST provenance + audit
Task create/update routes: when the field is present, `assertOperatorDecision(approvalProvenanceFromRequest(req))` → 403 `{ code }`; audit `task.grant.added|removed` with provenance + source; exec tools' schemas exclude the field (test asserts).
**Verify:** `bun test tests/plugins/tasks/routes-rest.test.ts tests/plugins/tasks/exec-tools.test.ts --isolate`. **Deps:** 2.1a. **Files:** `plugins/tasks/lib/routes*.ts`, tests. **Size:** S.

### 2.1c — tasks CLI
`bakin tasks create … --allow=<class,…>`, `bakin tasks allow|disallow <id> <class>` (operator header via the shared http plumbing; agent context refused).
**Verify:** `bun test tests/cli/tasks-grants.test.ts --isolate`. **Deps:** 2.1b. **Files:** `src/cli/commands/tasks.ts`, `src/cli/help.ts`, test. **Size:** S.

### 2.2a — schedule job grants + routes
`BakinJobMeta.grants?: { actions, setBy: ApprovalProvenance, revision }`; job create/update routes assert operator provenance when present; `bakin_exec_schedule_*` schemas exclude it (test).
**Verify:** `bun test tests/plugins/schedule/routes-jobs.test.ts tests/plugins/schedule/exec-tools.test.ts --isolate`. **Deps:** 2.1b. **Files:** `plugins/schedule/{types.ts,lib/job-service.ts,lib/routes/jobs.ts}`, tests. **Size:** S.

### 2.2b — inheritance + exempt block reason
Fire engine copies `grants.actions` onto the created task with `inheritedFrom { jobId, revision, setBy }` (audit `schedule-inherit`); `AWAITING_APPROVAL_REASON` joins the triage-exempt reasons in failure tracking; edits affect future tasks only (test).
**Verify:** `bun test tests/plugins/schedule/blocked-fire-routing.test.ts tests/plugins/schedule/scheduler.test.ts --isolate`. **Deps:** 2.2a, 2.4a. **Files:** `plugins/schedule/lib/fire-engine.ts`, tests. **Size:** S.

### 2.2c — schedule CLI
`bakin schedule create … --allow=<class,…>` and `bakin schedule allow|disallow <jobId> <class>` with `--as human`.
**Verify:** `bun test tests/cli/schedule-grants.test.ts --isolate`. **Deps:** 2.2a. **Files:** `src/cli/commands/schedule.ts`, help, test. **Size:** S.

### 2.4b — gate handler, subscriber, reconciliation, manual-move cancel
`registerPluginGate('tasks','action')`: validate-only `onResolve` (409), `ownerState`; `approval.resolved` subscriber → `applyCommittedApproval` (status ∈ approved/rejected, current generation, blocked guard only from `pending`); boot reconciliation over `pending|applying`; human move out of blocked cancels the approval; delete/archive ⇒ orphaned.
**Verify:** `bun test tests/plugins/tasks/approval-gate.test.ts --isolate` (approve / approve-all adds grant / reject / cancel ignored / superseded / crash-replay from `applying` / boot). **Deps:** 2.4a, 2.1a. **Files:** `approval-gate.ts`, `plugins/tasks/index.ts`, test. **Size:** M.

### 2.5 — exec tools `request_approval` + `approval_outcome`
Per spec §4.3 (caller rule via ledger live run → `no_task`; workflow refusal; standing auto-approve + log + audit; hash reuse; request with three options; block with exempt reason; `attempting → done|failed|unknown`, second `attempting` refused).
**Verify:** `bun test tests/plugins/tasks/request-approval.test.ts tests/plugins/tasks/exec-tools.test.ts --isolate`. **Deps:** 2.4b. **Files:** `plugins/tasks/lib/exec-tools.ts`, `approval-gate.ts`, tests. **Size:** M.

### 2.6a — dispatch resume: plumbing + main/triage
`dispatch-prepare` loads the task's gate state; `buildDispatchMessage` renders the `approvals` section in the main and triage branches (grants, the one actionable request with full command / attempted-unknown verify-first wording, the rule); fixtures `main-agent.txt`, `triage*.txt` regenerated.
**Verify:** `bun test tests/core/dispatch-prompts.test.ts tests/core/dispatch-prompt-fixtures.test.ts --isolate`. **Deps:** 2.4a. **Files:** `src/core/dispatch-prompts.ts`, `src/core/dispatch-prepare.ts`, fixtures, tests. **Size:** M.

### 2.6b — dispatch resume: specialist/workflow + budget
Same section in specialist and workflow branches; history summaries ≤ 1 KB with omission marker; budget test (command cap + 2 KB framing + 1 KB history); remaining fixtures regenerated.
**Verify:** same files. **Deps:** 2.6a. **Size:** S.

### 2.7a — UI: approve-all rendering + grants editor
ApprovalPanel plugin-gate renderer: `approve-all` as secondary with the caption. Task detail editor: **the grants editor is a composition of `Input` (class entry, regex-validated, Enter adds) + `Badge` tokens each with a remove `Button`**, all `@makinbakin/sdk/ui` primitives inside the existing `Field` layout — decided now (no fitting pattern exists: `Combobox` multiple needs a fixed option list, and tasks' `tags` has no editor to reuse). The conformance skill runs first in build; if it asks for adjustments, the composition changes, the scope does not — both editors (task detail, job form) ship as the spec requires. A `CanonicalUsage` story is added only if the editor is promoted to the SDK; for now it stays plugin-local.
**Verify:** `bun test tests/plugins/tasks/approval-panel.test.tsx tests/plugins/tasks/grants-editor.test.tsx --isolate`; `bun run ui:conformance --quick`. **Deps:** 2.1b, 2.4b. **Files:** `plugins/tasks/components/{approval-panel,task-detail-modes,grants-editor}.tsx`, tests. **Size:** M.

### 2.7b — UI: job-form grants
Reuse the grants editor in the schedule job form.
**Verify:** `bun test tests/plugins/schedule/job-form.test.tsx --isolate`; conformance quick. **Deps:** 2.7a, 2.2a. **Size:** S.

### 2.8a / 2.8b — docs
2.8a: `approvals.md` (tasks `action` gate, post-commit application), `tasks-plugin.md` (tools, field, state machine), `dispatch.md` (resume section). 2.8b: `bakin-owned-scheduler.md` (grants inheritance, exempt reason), new `provider-integrations.md` (why, classes, follow-ups), CLAUDE.md pointer. **Size:** S each.

### Checkpoint: PR2
- [ ] Gate green incl. `ui:conformance --full`; ≥2 Codex rounds fixed.
- [ ] Mark on 3737 (restarted on the branch): **W2** (gated Gmail reply, Discord card, `attempting`/`done`) and **W3** (gh triage, approve-all) pass; Bits PR marked ready.

---

## Phase 3 — PR3: schedule chat target

### 3.2 — ledger: target, chat columns, `starting`, retention
Migration vN as a **transactional table rebuild** (the `disposition` CHECK excludes new values): create `cron_fires_v2` with `target TEXT NOT NULL DEFAULT 'task'`, `chat_id`, `turn_id`, CHECK including `'starting'`; copy rows (incl. `skip_reason`); drop; rename; re-create indexes. `pruneCronFires` deletes only `disposition NOT IN ('pending','starting')`. Verbs: `claimCronFire(…, target)`, `markCronFireStarting`, `attachCronChatTurn`; `findHealableCronClaims` returns `pending` and `starting`; `CronFireRow` typed.
**Verify:** `bun test tests/core/execution-ledger.test.ts tests/core/execution-ledger-migration.test.ts --isolate` (fixture db at v(N-1) with rows → rebuilt preserving keys/skip_reason; retention keeps `starting`; downgrade: the rebuilt db still opens under the old migration list when no `starting` rows exist). **Deps:** none. **Files:** `packages/core/src/execution/ledger.ts`, tests. **Size:** M.

### 3.1a — chat user-row schema
`ChatTranscriptRow` user variant gains optional `turnId`, `admissionKey`; store zod + `ChatSummary.scheduleJobId` (immutable).
**Verify:** `bun test tests/plugins/chat/store.test.ts --isolate`. **Deps:** none. **Files:** `plugins/chat/{types.ts,lib/store.ts}`, test. **Size:** S.

### 3.1b — engine `turn` option (non-breaking)
`start(…, { turn?: { turnId, admissionKey } })`: use the supplied turnId; persist `turnId` + `admissionKey` on the user row BEFORE launch; an existing user row with that `admissionKey` ⇒ start nothing, emit nothing, log the dedupe, answer `'accepted'`. `StartTurnResult` unchanged; `startChatTurn` forwards the option.
**Verify:** `bun test tests/core/conversation-turns.test.ts tests/plugins/chat/scheduled-turns.test.ts --isolate` (the latter is created here and extended in 3.3a). **Deps:** 3.1a. **Files:** `packages/core/src/conversation/turns.ts`, `plugins/chat/lib/stream-bridge.ts`, tests. **Size:** S.

### 3.1c — interrupted-turn sweep by row turnId
`sweepInterruptedTurns` stamps the terminal row with the user row's `turnId` when present.
**Verify:** `bun test tests/plugins/chat/store.test.ts --isolate`. **Deps:** 3.1b. **Size:** S.

### 3.3a — chat hooks
`chat.startScheduledTurn({ jobId, runId, turnId, chatId?, agentId, title, message })` (use or create chat with `scheduleJobId`, `startChatTurn` with `turn` + `queueIfBusy: false`, returns `{ chatId, started: true } | { busy } | { chat_missing }`) and `chat.findScheduledTurn({ chatId, admissionKey })` (effect-free).
**Verify:** `bun test tests/plugins/chat/scheduled-turns.test.ts --isolate`; `tests/plugins/chat/channel-inbound.test.ts` gains "no relay for schedule chats". **Deps:** 3.1b. **Files:** `plugins/chat/{index.ts,lib/stream-bridge.ts}`, tests. **Size:** M.

### 3.3b — scheduled badge in the chat list
**Verify:** `bun test tests/plugins/chat/chat-list.test.tsx --isolate`; conformance quick. **Deps:** 3.1a. **Size:** S.

### 3.4a — job types + validation (chat still refused)
`BakinJobMeta.target`, `chat?: { chatId }`; validation refuses task-only fields for chat targets and requires `agentId`; **creating/updating a job with `target: 'chat'` is refused `not_yet_supported` until 3.4e** so no intermediate commit can fire a chat job as a task.
**Verify:** `bun test tests/plugins/schedule/routes-jobs.test.ts --isolate`. **Deps:** none. **Files:** `plugins/schedule/{types.ts,lib/job-service.ts,lib/routes/jobs.ts}`, tests. **Size:** S.

### 3.4b — fire path for chat targets
claim(target) → `preDispatchGate` + overlap (in-flight or `starting` for this job) → use/create chat → record binding if changed (deleted chat / agent change ⇒ new chat; target switch resets binding) → `starting` → hook → `created` / `skipped: chat_busy|chat_unavailable`.
**Verify:** `bun test tests/plugins/schedule/fire-engine-chat.test.ts --isolate` (happy path, busy, gate hold, rebinding cases). **Deps:** 3.2, 3.3a, 3.4a. **Files:** `plugins/schedule/lib/fire-engine.ts`, test. **Size:** M.

### 3.4c — healer and crash recovery
`pending` ⇒ full flow by the ROW's target; `starting` ⇒ `findScheduledTurn` → duplicate ⇒ `created` / chat gone ⇒ `skipped: chat-deleted` / unstarted ⇒ current admission checks then hook; a `starting` occurrence never replays into a replacement chat.
**Verify:** same test file, crash matrix (before starting / after starting before user row / after user row before created / chat deleted / job paused meanwhile / agent changed meanwhile). **Deps:** 3.4b. **Size:** M.

### 3.4d — catch-up, failure accounting, run readers
Missed-window chat occurrences skipped; failure tracking by the row's `turn_id` terminal row (done / error / aborted / swept); bookkeeping after `created`; `runs-reader` emits chat runs.
**Verify:** `bun test tests/plugins/schedule/{one-shot-completion,cron-dedup,runs-reader}.test.ts --isolate`. **Deps:** 3.4c. **Files:** `fire-engine.ts`, `runs-reader.ts`, tests. **Size:** S.

### 3.4e — routes accept chat + form switch + `{fireAt}`
Lift the `not_yet_supported` refusal; job form target switch hides task-only fields; `{fireAt}` template var in the prompt guard/renderer.
**Verify:** `bun test tests/plugins/schedule/{routes-jobs,job-form,prompt-guard}.test.* --isolate`; conformance quick. **Deps:** 3.4d. **Files:** `lib/routes/jobs.ts`, `components/job-form.tsx`, `lib/prompt-guard.ts`, tests. **Size:** S.

### 3.5 — run history + job row chat links
**Verify:** `bun test tests/plugins/schedule/{run-history,job-row}.test.tsx --isolate`; `bun run ui:conformance --full`. **Deps:** 3.4e. **Size:** S.

### 3.6 — docs
`bakin-owned-scheduler.md` (chat target, `starting`, recovery matrix, rollback quiescence, §10 known gaps), `chat-plugin.md`, `conversation-kit.md` (turn identity option), `execution-ledger.md` (rebuild migration, retention rule), CLAUDE.md pointers. **Size:** S.

### Checkpoint: PR3
- [ ] Gate green incl. `ui:conformance --full`; ≥2 Codex rounds fixed.
- [ ] Mark on 3737: creates the digest job with a chat target; **W4** passes (run-now or next morning); unread badge + toast observed; a run-now while a turn is in flight shows `chat_busy`.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| gog OAuth setup friction blocks W1 | Med | README + remediation name every step; `gog auth setup --dry-run` first |
| Agents bypass `request_approval` | Med (policy) | skill + resume section repeat the contract; W2/W3 observe; `--readonly` reads |
| Grants editor composition needs rework under conformance | Low | adjust the composition (primitives only); scope unchanged |
| Turn engine `turn` option regresses interactive chat | Low | option absent ⇒ behaviour byte-identical; `conversation-turns.test.ts` pins both paths |
| Ledger rebuild on margo's db | Med | migration test from a v(N-1) fixture incl. rows; backup `bakin.db` before upgrade (release note) |
| Rollback after state is written | Med | the quiescence table above; downgrade tests in 3.2 |
| Codex rounds change a decision | Med | amend the spec first, then the plan, then code |

## Open questions
None blocking. The grants editor composition is confirmed with the conformance skill at 2.7a.

## Todo
- [ ] B1 · [ ] B2a · [ ] B2b · [ ] B3 · [ ] B4 · [ ] B5 · [ ] Bits checkpoint
- [ ] 1.1 · [ ] 1.2 · [ ] 1.3 · [ ] 1.4a · [ ] 1.4b · [ ] 1.4c · [ ] 1.5a · [ ] 1.5b · [ ] 1.5c · [ ] 1.6 · [ ] PR1 gate · [ ] Codex ×2 · [ ] W1 (Mark)
- [ ] 2.3 · [ ] 2.4a · [ ] 2.1a · [ ] 2.1b · [ ] 2.1c · [ ] 2.2a · [ ] 2.2b · [ ] 2.2c · [ ] 2.4b · [ ] 2.5 · [ ] 2.6a · [ ] 2.6b · [ ] 2.7a · [ ] 2.7b · [ ] 2.8a · [ ] 2.8b · [ ] PR2 gate · [ ] Codex ×2 · [ ] W2+W3 (Mark)
- [ ] 3.2 · [ ] 3.1a · [ ] 3.1b · [ ] 3.1c · [ ] 3.3a · [ ] 3.3b · [ ] 3.4a · [ ] 3.4b · [ ] 3.4c · [ ] 3.4d · [ ] 3.4e · [ ] 3.5 · [ ] 3.6 · [ ] PR3 gate · [ ] Codex ×2 · [ ] W4 (Mark)
