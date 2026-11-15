# Implementation Plan: Provider integrations (Google Workspace + GitHub)

Spec: `provider-integrations.md` **rev 6** (signed off 2026-11-14 after four
Codex rounds). Plan **rev 4** replaces rev 3's PR2 (tasks-plugin gate,
agent-runs-a-CLI) with the provider relay, adds the paste-a-link fix and PR4
(Bakin-owned Google client), and reworks the Bits PR. PR1 is built and
unchanged; PR3's tasks carry over from rev 3. Status marks are kept HERE.

## Overview

Six deliverables, each a reviewable checkpoint:

| # | Deliverable | Branch (base) | Live test |
|---|---|---|---|
| 1 | **PR1** login verification (#1087, built) | `feat/pack-login-verification` (main) | W1 on the CLI packs |
| 2 | **Fix** paste-a-link refuses runtime-plugin bundles | `fix/paste-a-link-runtime-plugins` (main) | paste pi-google-services → clear refusal |
| 3 | **PR2** provider relay + approval gate (tasks + chats) | `feat/provider-relay` (PR1 branch) | W1 again via the relay, W2, W3, W4 |
| 4 | **Bits #143** reworked: `mcpServers`, class tables, relay skills | `feat/google-github-packs-v2` (main) | rides PR2's live test |
| 5 | **PR3** schedule chat target | `feat/schedule-chat-target` (PR2 branch) | W5 |
| 6 | **PR4** Bakin Google client + Connect | `feat/google-connect` (PR2 branch) | W6 (needs Mark's Cloud project) |

The Bits PR stays open until PR2 passes Mark's live test. PR3 and PR4 are
independent of each other; both stack on PR2. I merge nothing.

## Architecture decisions (spec rev 6, not re-litigated)

D1 cooperative · D3 refuse + exact-args card, one matching call, agent-bound,
expiring · D4 one card for tasks and chats, chat approval → follow-up turn ·
D5 three classes from reviewed tables · D6 standing grants per task per action
class · D7 gate in core at the relay, `integration-action` owner · D10 gog +
github-mcp-server pinned, gh for login/token · D11 one relay skill per pack ·
D12 Bakin-owned Google client, Connect + paste-back, full access default ·
D15 relay, not runtime-native MCP · D16 gog MCP gaps ship as gaps.

## Branch, commit, gate and rollback strategy

- Branches live in the main checkouts so 3737 serves them; server-side
  changes need a 3737 restart to test (Mark's call).
- **One task = one conventional commit**, each leaving lint, typecheck and the
  task's test files green — a bisectable rollback checkpoint. Docs are their
  own commits inside the PR. No AI attribution.
- **No published-contract breaks:** `PluginToolContext.invocation` and
  `ExecToolDefinition` change additively (a raw-schema variant beside the zod
  shape); `StartTurnResult` stays as is; every persisted change is additive.
- **Per-PR gate before "ready for review":** `bun run lint && bun run
  typecheck && bun run check:cycles`; the PR's test files `--isolate`; `bun
  run test` once (never beside `ui:conformance`); `ui:conformance --quick`
  after each UI task and `--full` before ready; **≥2 Codex rounds** fixed
  in-batch; then Mark's live test; then Mark merges.
- **Upstream contributions** (the gog no-retry fix) are outward-facing: drafted
  in PR2, opened only after Mark says so.

**Rollback is a procedure, not a revert:**

| PR | What old code does with the new state | Quiescence BEFORE reverting | Verified by |
|---|---|---|---|
| PR1 | ignores receipts and `login` | none | — |
| Fix | nothing persisted | none | — |
| PR2 | `integration-action` records fail the old discriminated schema and are **skipped with a warning** (`packages/core/src/approvals/store.ts`) — invisible, never decidable; relay sidecars ignored; `approvedActions` kept as unknown JSON; old manifest schemas **strip** `mcpServers`, so a Bits 2.0 pack would install as a plain skill pack whose skill names tools that do not exist — Bits 2.0 therefore carries a `bakin` floor = the PR2 rc and is refused by older hosts | decide or cancel every pending `integration-action` approval; no `attempting` sidecar left; move awaiting-approval tasks to todo; pause grant-carrying schedules; re-install the Bits packs at their pre-relay version | downgrade test: the previous build boots on a PR2 data dir (decided approvals + sidecars) without error and lists no ghost approvals |
| PR3 | old scheduler runs a `target: 'chat'` job as a TASK; old retention deletes `starting` rows; old run readers label `starting` as success; old chat parsing drops schedule-only row fields | pause every chat-target job; wait until no `starting` row remains and every `created` chat run's turn has a terminal row; only then revert | downgrade test (3.2): a db with a settled PR3 history opens under the previous migration set |
| PR4 | the `bakin` gog client stays registered and harmless; the persisted account selection and scope profile are ignored | set `GOG_ACCOUNT` to the selected account (or clear the selection) so the old login check verifies the same account | — |

Reverse dependency order: PR4/PR3 → PR2 (+ Bits) → Fix/PR1.

## Dependency graph

```
Fix  F1 detect+refuse → F2 Explore copy → F3 docs → GATE
PR2  2.1 invocation type+Pi path → 2.2 MCP-side caller resolution
     2.3 raw-schema exec tools → 2.4 live registry (mcp-server add/remove/list_changed)
     2.5 manifest mcpServers + classify (pure) → 2.6 relay supervisor (needs 2.3, 2.4, 2.5)
     2.7a approvals owner kind (core) → 2.7b approval consumers (store/tasks hook/attention/Discord/OpenClaw)
     2.8a–c approvedActions field, REST, CLI → 2.9a–c schedule grants, inheritance+exempt reason, CLI
     2.10 gate state machine (pure) → 2.11 gate wiring in the relay (needs 2.1, 2.2, 2.6, 2.7a, 2.8)
     2.12 apply-after-commit: task anchor + boot reconciliation → 2.13 chat anchor (enqueueFollowUp + admission key schema) → 2.13b boot the relay
     2.14 dispatch resume section → 2.15 UI (card in panel + inline chat, approve-all, grants editor, job form)
     2.16 settings.integrations.privateNeedsApproval → 2.17 OpenClaw rig check → 2.18 gog no-retry draft → 2.18b verify boot → 2.19 docs → GATE → W1/W2/W3/W4
Bits B1 google 2.0 (needs 2.5 schema) → B2 github 2.0 → B3 tools/list fixtures + contract → B4 skills → B5 READMEs
PR3  rev 3 tasks 3.2 … 3.6 (unchanged order) → GATE → W5
PR4  4.1 client constants + gog registration → 4.2 persisted account selection → 4.3 Connect API → 4.4 Connect dialog → 4.5 Bits setup=Connect → 4.6 docs → GATE → W6
```

Parallel-safe: Fix beside PR2; Bits beside PR2 after 2.5; PR3 beside PR4.

---

## Phase 1 — PR1: login verification (BUILT, #1087)

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
- [x] Gate green (lint, typecheck, cycles, PR tests, full suite, conformance quick + full); ≥2 Codex rounds fixed — nine rounds (r3 and r9 APPROVE; r4–r8 blockers B1–B7 fixed in-batch, see §4.1 `expect` amendment).
- [x] `verify` boot: install google-workspace from the local Bits checkout → `login: missing` + setup command; a receipt made stale by a pin change → `unknown`.
- [ ] Mark on 3737: installs via Explore, creates the OAuth client, runs setup, Check login → ok; **W1 passes** in chat.

---

---

## Phase F — paste-a-link refuses runtime-plugin bundles

### F1 — detect and refuse
In the hub-skill staging path (`src/core/agent-packages/ref-normalize.ts` →
manifest synthesis), before synthesis: a staged root whose `package.json`
carries a `pi` field or `pi-package` keyword, an `openclaw.extensions` field,
or an `openclaw.plugin.json` file is refused with typed `runtime_plugin_bundle`
("This is a Pi/OpenClaw plugin, not an Agent Skill. Bakin installs runtime
plugins only through a capability pack.") — no consent token, nothing written.
**Acceptance:** pi-google-services' shape, an OpenClaw plugin, and a real skill
repo each take the right path. **Verify:** `bun test
tests/agent-packages/hub-skill-*.test.ts --isolate`. **Size:** S.

### F2 — Explore drawer copy
The paste-a-link drawer renders the refusal through the existing error state
(no new pattern). **Verify:** RTL test; `ui:conformance --quick`. **Size:** S.

### F3 — docs
`skill-hub-interop.md` (what is refused and why). **Size:** XS.

### Checkpoint: Fix
- [ ] Gate green; ≥2 Codex rounds; Mark pastes the pi-google-services link on 3737 and sees the refusal.

---

## Phase 2 — PR2: provider relay + approval gate

### 2.1 — invocation context: type + Pi path
`PluginToolContext.invocation` becomes `{ agentId, turn?: { kind: 'task',
taskId, runId } | { kind: 'chat', chatId, turnId } }` (additive). `RuntimeExecToolProvider.invoke`
(`packages/core/src/adapters/shared.ts`) gains the turn argument and
`src/core/exec-tools/provider.ts` passes it into the context it builds.
`MessageArgs` gains `invocationTurn` set by dispatch (`threadId task:<id>:d<seq>`) and by the
conversation turn engine; Pi's `tool-bridge.ts` passes it to every handler.
**Verify:** `bun test tests/adapter-pi/tool-bridge.test.ts tests/core/exec-tool-provider.test.ts tests/core/dispatch*.test.ts tests/core/conversation-turns.test.ts --isolate` — a task turn and a chat turn each reach a real handler with their context.
**Files:** `packages/core/src/plugin-types.ts`, `packages/core/src/adapters/shared.ts`, `src/core/exec-tools/provider.ts`, `packages/core/src/adapters/runtime/concepts.ts`, `packages/adapter-pi/src/{tool-bridge,messaging}.ts`, `src/core/dispatch*.ts`, `packages/core/src/conversation/turns.ts`, tests. **Size:** M.

### 2.2 — MCP-side caller resolution
`src/core/integrations/caller.ts`: for MCP calls (no turn on the transport),
resolve the agent's live turns from the dispatch in-flight registry and the
conversation engine; exactly one → that turn; none → `no_caller`; several →
`ambiguous_caller`. **Verify:** `bun test tests/core/integrations/caller.test.ts --isolate`. **Size:** S.

### 2.3 — raw-schema exec tools
`ExecToolDefinition` gains a variant `{ inputSchema: JSONSchema, parameters?:
never }`; `src/core/exec-tools/provider.ts` and `src/core/mcp-server.ts`
declare it verbatim, validate only "is a JSON object", preserve unknown
properties. Zod tools unchanged (arch test: every core/plugin tool still zod). The HTTP
exec endpoint (`packages/host/src/api/exec-tools/[toolName].ts`, zod-parses
unconditionally) refuses raw-schema tools with `relay_tool_not_http` — HTTP
callers carry no turn.
**Verify:** `bun test tests/core/exec-tool-provider.test.ts tests/core/exec-tools/*.test.ts tests/core/mcp-server*.test.ts tests/host/exec-tools-route.test.ts --isolate`. **Size:** M.

### 2.4 — live registry
Registry emits `added`/`removed`; `mcp-server.ts` keeps live sessions in sync
(register/remove + `notifications/tools/list_changed`) instead of snapshotting
at connect; a call to a removed relayed tool → `tool_removed`. **Verify:** a
connected MCP client test sees a tool appear and disappear. **Size:** M.

### 2.5 — manifest `mcpServers` + classify (pure)
Zod schema per spec §4.2 (bin must be the pack's own; `token.prereq` declared;
`tools` rows incl. `byArg`, `refuseUnless`, `expose: false`); install refuses
`mcpServers` from hub-skill synthesis and third-party remote refs (typed);
the official Bits refs and a local path the operator names are accepted (a
local install is an operator action under D1 — this is how the Bits branch and
the 2.18b fixture install). `src/core/integrations/classify.ts`:
`classify(table, tool, args) → { class, action } | { refused: 'inexact_send' } | hidden`.
**Verify:** `bun test tests/agent-packages/manifest.test.ts tests/core/integrations/classify.test.ts --isolate`. **Size:** M.

### 2.6 — relay supervisor
`src/core/integrations/relay.ts` with `@modelcontextprotocol/sdk` `Client` +
`StdioClientTransport`: spawn the pinned bin with args/readonlyArgs, account
flag from the login receipt, token from `token.command` per spawn with
`{account}` substituted from that receipt (stdout never logged; a receipt
change respawns); 30 s request deadline; backoff 1 s → 60 s; `tools/list` on
connect → register/unregister `bakin_exec_<id>_<tool>` (raw schema, class in
the description, hidden rows skipped); states `token-unavailable` /
`auth-rejected` / `start-failed` into capability readiness. **Not booted yet:** this
task delivers the supervisor and registration under test only; boot wiring is
task 2.13b, after the gate and both anchors exist, so no intermediate commit
exposes an ungated external tool. **Verify:** `bun test tests/core/integrations/relay.test.ts --isolate` against a fake stdio MCP server fixture (`tests/fixtures/fake-mcp-server.ts`: read/private/external tools, call log, crash-on-demand). **Size:** L → split if it exceeds one session (supervisor / registration).

### 2.7a — approvals: `integration-action` owner (core)
`ApprovalOwner` union + zod schema + store list filter `chatIds`; the kind's
`ownerState` (anchor live) and validate-only `onResolve`; **every consumer
that reads `owner.taskId` narrows in this same commit** (`use-task-approvals.ts`,
`TaskApproval`, the attention provider's task path) so the commit typechecks;
chat surfaces come in 2.7b. **Verify:** `bun test tests/core/approvals/*.test.ts --isolate`. **Size:** M.

### 2.7b — approval consumers
`approvals-attention-provider.tsx` (chat-anchored events announce, link
`/chat/$chatId`), Discord card links,
OpenClaw two-option card + "Approve all is on the board". **Verify:** the
touched tests + a new attention-provider chat case. **Size:** M.

### 2.8a — `approvedActions` field + creation funnel
`Task`/`TaskCreateInput`/`TaskUpdateInput` (null clears), store schema,
`public-task` patch, `createTaskWithEffects` input + forwarding; `ctx.tasks`
refuses the field (plugins carry no request provenance). Class regex
`^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`.
**Verify:** `bun test tests/core/task-service.test.ts tests/plugins/tasks/integration.test.ts --isolate`. **Files:** `packages/sdk/src/types/services.ts`, `packages/core/src/tasks/{store,public-task}.ts`, `src/core/task-service.ts`, `src/lib/plugin-context-services.ts`. **Size:** M.

### 2.8b — REST provenance + audit
Task create/update routes: field present → `assertOperatorDecision(approvalProvenanceFromRequest(req))` → 403 `{ code }`; audit `task.grant.added|removed` (provenance, source); tasks exec-tool schemas exclude the field (test).
**Verify:** `bun test tests/plugins/tasks/routes-rest.test.ts tests/plugins/tasks/exec-tools.test.ts --isolate`. **Size:** S.

### 2.8c — tasks CLI
`bakin tasks create … --allow=<class,…>`, `bakin tasks allow|disallow <id> <class>` (operator header; agent context refused).
**Verify:** `bun test tests/cli/tasks-grants.test.ts --isolate`. **Files:** `src/cli/commands/tasks.ts`, `src/cli/help.ts`. **Size:** S.

### 2.9a — schedule job grants + routes
`BakinJobMeta.grants?: { actions, setBy, revision }`; job routes assert operator provenance when present; `bakin_exec_schedule_*` schemas exclude it.
**Verify:** `bun test tests/plugins/schedule/routes-jobs.test.ts tests/plugins/schedule/exec-tools.test.ts --isolate`. **Size:** S.

### 2.9b — inheritance + exempt block reason
Fire engine copies `grants.actions` onto created tasks with `inheritedFrom { jobId, revision, setBy }` (audit `schedule-inherit`); `AWAITING_APPROVAL_REASON` joins the triage-exempt reasons; job edits affect future tasks only.
**Verify:** `bun test tests/plugins/schedule/blocked-fire-routing.test.ts tests/plugins/schedule/scheduler.test.ts --isolate`. **Size:** S.

### 2.9c — schedule CLI
`bakin schedule create … --allow=<class,…>`, `bakin schedule allow|disallow <jobId> <class>` with `--as human`.
**Verify:** `bun test tests/cli/schedule-grants.test.ts --isolate`. **Size:** S.

### 2.10 — gate state machine (pure)
`src/core/integrations/gate-state.ts`: sidecar per approval
(`pending → applying → approved-unconsumed | rejected`; `attempting → done |
failed | unknown`; `expired`), the match key (agent, scope, server, account,
tool, argsHash), canonical JSON, expiry (24 h / anchor end), outcome mapping
by class. **Verify:** `bun test tests/core/integrations/gate-state.test.ts --isolate`. **Size:** M.

### 2.11 — gate wiring
The relay's handler: classify → forward / refuse / match-and-consume
(`attempting` written before forwarding) / standing grant auto-approval /
create-or-reuse the pending card; tasks block with `AWAITING_APPROVAL_REASON`;
returns `needs_approval`. **Verify:** `bun test tests/core/integrations/gate.test.ts --isolate` (the spec §8 matrix incl. concurrent double call, changed args, reassigned task, inexact send, external `isError` → unknown). **Size:** M.

### 2.12 — apply-after-commit: task anchor + reconciliation
`approval.resolved` subscriber + boot reconciliation over `pending`,
`applying`, outcome-less `attempting` (→ `unknown`); task log, approve-all
grant, blocked → todo, `triggerDispatch`; human move out of blocked cancels.
**Verify:** `bun test tests/core/integrations/apply.test.ts --isolate` with crash injection before/after the provider call. **Size:** M.

### 2.13 — chat anchor: follow-up turn
Chat hook `chat.enqueueFollowUp({ chatId, admissionKey, message })`. The
admission-key persistence lands HERE, not in PR3: `plugins/chat/lib/store.ts`
strips unknown fields from transcript and queue rows today, so the queue-row
and user-row schemas gain `admissionKey` in this task (second enqueue = no-op;
a crashed drain finds the key on the transcript and skips). Restart test:
enqueue, crash before drain, restart, exactly one turn.
**Verify:** `bun test tests/core/conversation-turns.test.ts tests/plugins/chat/follow-up.test.ts --isolate`. **Size:** M.

### 2.13b — boot the relay
`server.ts` starts the supervisor after capability readiness; pack
install/sync/remove restart it — never in `createAppServices()`. Test: a boot
with an installed fixture pack registers its tools; removing the pack
unregisters them. **Size:** S.

### 2.14 — dispatch resume section
`approvals` section in every dispatch branch (grants; approved → "make exactly
this call again" with tool + args; pending → stop; unknown → verify first;
history ≤ 1 KB with omission marker); fixtures regenerated. **Verify:** dispatch
prompt tests + fixtures. **Size:** M.

### 2.15 — UI
Conformance skill first. ApprovalPanel renders `integration-action` (argument
preview, approve-all caption); the same card inline in chat under the asking
turn (conversation kit composition); the grants editor (rev 3's
Input + Badge composition) in task detail and the job form.
**Verify:** RTL tests; `ui:conformance --quick`. **Size:** M (two commits).

### 2.16 — `settings.integrations.privateNeedsApproval`
Settings schema + System & Alerts row; gate honors it. **Size:** S.

### 2.17 — OpenClaw rig check (manual, recorded)
`bun run instance up --runtime openclaw --mode isolated`: a relayed tool appears
to the OpenClaw agent through Bakin's MCP server, a gated call is refused with
a card, `ambiguous_caller` when a chat and a task overlap. Evidence in the PR.

### 2.18 — gog no-retry fix (draft only)
Patch for gogcli's retry transport (no retry for non-idempotent methods) +
test, kept in the scratchpad; opened upstream only on Mark's go. Also check
github-mcp-server's retry behaviour; record findings in the pack README.

### 2.18b — isolated verify boot (recorded)
The `verify` recipe (Pi pinned, `dispatch.paused`, `PI_HOME`/`OPENCLAW_HOME`
under the throwaway home): install a fixture pack from a local path whose
`mcpServers` points at the fake MCP server; drive a relayed read, a private
and an external call through BOTH surfaces — the Pi exec-tool provider and
Bakin's MCP endpoint — and confirm the card, the one matching pass and the
refusal of a second; `grep -l 3799 ~/.openclaw/openclaw.json` prints nothing
afterwards. Evidence in the PR.

### 2.19 — docs
New `.claude/knowledge/provider-integrations.md` (relay, classes, gate,
states, risks); `approvals.md` (owner kind, chat anchor), `capability-packs.md`
(`mcpServers`, server states), `tasks-plugin.md` (grants), `chat-plugin.md`
(follow-up turns, admission key), `dispatch.md`, `bakin-owned-scheduler.md`;
CLAUDE.md pointer; `docs/…/packages.md` (`mcpServers`). **Size:** M (two commits).

### Checkpoint: PR2
- [ ] Gate green incl. `ui:conformance --full`; ≥2 Codex rounds fixed.
- [ ] Mark on 3737 (restarted on the branch, Bits branch installed): W1 via the relay, W2, W3, W4.

---

## Phase B — Bits #143 rework

### B1 — google-workspace 2.0.0
`mcpServers[google]` per spec §4.2 with the class table, but **without
`--client bakin`** — PR2's live test runs on the operator's existing gog
client (Mark's, from W1); PR4 task 4.5 adds `--client bakin` to the args and
the login probe once the client exists. `bakin` floor = the PR2 rc. Drop the
vendored CLI references + `scripts/vendor-gog-skills.ts`. **Size:** M.

### B2 — github 2.0.0
`github-mcp-server` v2.1.0 pinned bin (four platforms, tarball + member sha256
from the release checksums), `mcpServers[github]` with the class table and
**github.com only in this release:** the login probe becomes `gh auth status
--hostname github.com --active` (today's unrestricted probe checks every host)
and `token: { command: ['gh','auth','token','--hostname','github.com','--user','{account}'] }`
with `{account}` from that receipt, so probe and token name the same identity.
Test: a second host with a different active account and the same username on
both never changes what the relay uses. Enterprise hosts are a follow-up. `bakin` floor = the PR2 rc. **Size:** M.

### B3 — tools/list fixtures + contract test
Captured `tools/list` JSON for both pinned servers; contract: every listed
tool has a row, no `read` row on a write-annotated tool, `bin` is the pack's
own, `token.prereq` declared. **Size:** S.

### B4 — skills
One relay skill per pack (spec §4.2 "Skills"); ≤ 6 KB each; `bakin agents
context` before/after recorded. **Size:** S.

### B5 — READMEs
Google: Connect (PR4) with the terminal fallback; the gog 5xx retry risk.
GitHub: `gh auth login`, account note. **Size:** S.

---

## Phase 3 — PR3: schedule chat target (rev 3 tasks; acceptance is now W5; a scheduled chat's external calls use the chat card from PR2; `admissionKey` on chat rows already exists from PR2 task 2.13, so 3.1a adds only the schedule-specific fields)

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

---

## Phase 4 — PR4: Bakin Google client + Connect

Prerequisite (Mark): the "Bakin" Google Cloud project, External consent
screen, Desktop OAuth client, test users added while unverified. Tasks 4.1–4.4
build against a placeholder client id until the real one exists.

### 4.1 — client constants + gog registration
`packages/core/src/integrations/google-client.ts`: id + secret and the two
pinned scope profiles — **full** `--services gmail,calendar,drive,docs,sheets
--gmail-scope full --drive-scope full` and **read-only** `--readonly` plus the
same services (exact flag values confirmed against `gog auth add --help` on the
pinned build, and against the relayed tool list so no scope is requested that
no tool uses). Idempotent `gog auth credentials` registration as client
`bakin` at pack install/sync (compared by client id). **Verify:** registration
test against a fake gog; scope-profile snapshot test. **Size:** S.

### 4.2 — persisted account selection
Pack state `{ accountSelection, scopeProfile }`; `login-verify.ts` prefers
the selection over `process.env[accountEnv]` and includes it in the receipt
invalidation key; the relay spawns on it with `args` or `readonlyArgs` by
`scopeProfile`. **Verify:** two stored accounts, selection wins,
survives restart, change invalidates. **Size:** S.

### 4.3 — Connect API
`POST /api/integrations/google/connect { email, access }` (declared operator,
agent contexts refused) → step 1 with the profile's frozen flags, returns URL + `attemptId` +
`expiresAt` (gog's own state expiry); one attempt at a time (a new one cancels
the old); `POST …/connect/:attemptId { url }` → state check → step 2
`--auth-url` → persist selection + profile → login check for that account →
relay respawn; the attempt is consumed (a second POST → 410). Pasted URLs
never logged. **Verify:** `bun test tests/host/api/google-connect.test.ts
--isolate` (single use, expiry, state mismatch, cancel-by-new-attempt, agent
context refused, URL absent from logs). **Size:** M.

### 4.4 — Connect dialog
ConfirmDialog-hosted flow in Explore's installed card and the runtime hub
Capabilities tab: email, access (Full default / Read-only), the "last page
will fail to load" explanation, the unverified-app warning and 100-user cap
while unverified, the attempt's expiry, open-in-new-tab, paste field,
outcome. Conformance skill first. **Verify:** `bun test
tests/plugins/explore/google-connect-dialog.test.tsx --isolate`;
`ui:conformance --quick`. **Size:** M.

### 4.5 — Bits: setup = Connect
google-workspace: `--client bakin` added to `args`, `readonlyArgs` and the
login probe; login `setup` points at the Connect action; README; `bakin`
floor = the PR4 rc. **Size:** S.

### 4.6 — docs
`provider-integrations.md` (client, verification track), `capability-packs.md`. **Size:** S.

### Checkpoint: PR4
- [ ] Gate incl. `--full`; ≥2 Codex rounds; Mark runs W6 on a fresh home.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| gog retries a send on Google 5xx | Low (rare duplicate email) | stated risk; upstream fix drafted (2.18); repin |
| MCP-side caller ambiguity on OpenClaw (chat + task overlap) | Med | `ambiguous_caller` refusal, never a guess; OpenClaw serializes same-agent dispatch |
| gog MCP lacks calendar writes / Drive upload / Docs create | Med (scope) | ship as gaps; upstream later (D16) |
| Exec-tool contract change ripples to plugins | Med | additive variant; arch test keeps every non-relayed tool zod |
| Agents ignore `needs_approval` and keep calling | Low | same refusal every time, one card per key; skill + resume repeat the rule |
| Google verification takes weeks | Med | unverified mode (warning + 100 users) works meanwhile; W6 does not need verification |
| Rollback after state is written | Med | quiescence table; downgrade test in PR2 |
| Codex rounds change a decision | Med | amend the spec first, then the plan, then code |

## Open questions
None blocking. Decided in build: the grants editor composition (conformance
skill, 2.15); the gog credentials command (4.1).

## Todo
- [x] Bits B1–B6 (rev 3, CLI packs) · [x] 1.1–1.6 · [x] PR1 gate · [x] Codex ×2 · [ ] W1 (Mark)
- [ ] F1 · [ ] F2 · [ ] F3 · [ ] Fix gate · [ ] Codex ×2 · [ ] Mark check
- [ ] 2.1 · [ ] 2.2 · [ ] 2.3 · [ ] 2.4 · [ ] 2.5 · [ ] 2.6 · [ ] 2.7a · [ ] 2.7b · [ ] 2.8a · [ ] 2.8b · [ ] 2.8c · [ ] 2.9a · [ ] 2.9b · [ ] 2.9c · [ ] 2.10 · [ ] 2.11 · [ ] 2.12 · [ ] 2.13 · [ ] 2.13b · [ ] 2.14 · [ ] 2.15 · [ ] 2.16 · [ ] 2.17 · [ ] 2.18 · [ ] 2.18b · [ ] 2.19 · [ ] PR2 gate · [ ] Codex ×2 · [ ] W1/W2/W3/W4 (Mark)
- [ ] B1 · [ ] B2 · [ ] B3 · [ ] B4 · [ ] B5 (rev 4 rework)
- [ ] 3.2 · [ ] 3.1a · [ ] 3.1b · [ ] 3.1c · [ ] 3.3a · [ ] 3.3b · [ ] 3.4a · [ ] 3.4b · [ ] 3.4c · [ ] 3.4d · [ ] 3.4e · [ ] 3.5 · [ ] 3.6 · [ ] PR3 gate · [ ] Codex ×2 · [ ] W5 (Mark)
- [ ] Mark: Google Cloud project · [ ] 4.1 · [ ] 4.2 · [ ] 4.3 · [ ] 4.4 · [ ] 4.5 · [ ] 4.6 · [ ] PR4 gate · [ ] Codex ×2 · [ ] W6 (Mark)

