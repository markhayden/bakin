# Runtime Capability Foundation

How Bakin runs against N runtimes (OpenClaw, Pi, next) without runtime
assumptions leaking upstream of the adapters. Built by the
`.claude/specs/runtime-capabilities/` phase series (checkpoints α–ε).

## The capability model

Every runtime adapter declares what it provides through
`capabilities(): Promise<CapabilitySet>` (`packages/core/src/adapters/runtime/concepts.ts`):

| Capability | Modes | Notes |
|---|---|---|
| `toolCalling` | always `native` + a `RuntimeToolAccess` descriptor | every runtime must provide tool calling |
| `delivery` | native / shimmed / unavailable | Pi: `shimmed` when the Discord delivery bridge is configured (#669, delegation via `AdapterInitOpts.channelBridge` — see `.claude/knowledge/delivery-bridge.md`), `unavailable` otherwise. Conformance pins surface-present for BOTH native and shimmed |
| `imageGen` | native / shimmed / unavailable | Pi computes honestly: codex OAuth → native, Bakin provider key only → shimmed, neither → unavailable. OpenClaw is structurally native (`infer image` exists; provider config is per-provider data) |
| `memory` / `sessions` / `workspaceFiles` | native / unavailable | |
| `input` | `{ imageInput, audioInput }` | conservative model-catalog probe for the agent's effective model |

Rules of the model:
- **Modes are honest.** `shimmed` means Bakin's own shim serves the gap;
  `unavailable` degrades visibly (UI states, honest tool errors) — never a
  silent fallback, never a throwing stub.
- **Consumers gate on the descriptor**, not on ad-hoc probes. Example: the
  images plugin fails generation early on `imageGen.mode === 'unavailable'`
  before any provider fusing (`plugins/images/lib/tools.ts`).
- **Optional members mean absence IS the signal**: `channels?` and `cron?`
  are omitted by runtimes without them (Pi omits both). Consumers
  feature-detect (`runtime.channels?.…`); an arch rule bans `.channels!.` /
  `.cron!.` in production code (`tests/architecture/adapter-boundary.test.ts`).
  Since PR1 of #191 the conformance suite pins the cron side: each runner
  declares `cron: 'present' | 'absent'` and a CRUD round-trip runs against
  any adapter exposing the member (openclaw via the crab CLI shim — the real
  CLI/file-store path). Absence must be member omission, never a stub.

## Tool access — one renderer, adapter-owned provisioning

- `describeToolAccess(): RuntimeToolAccess` (sync, static) declares HOW agents
  invoke Bakin's `bakin_exec_*` tools: `in-process` (Pi), `mcp` (OpenClaw
  native MCP, per-agent server `bakin-<agent>`), or `cli-shim` (inert
  extension point).
- `src/core/tool-access.ts` is the ONE renderer: `renderToolCall()` renders a
  single invocation; `renderToolAccessInstructions()` renders the standing
  "Tool access" block. Dispatch prompts, workflow prompts, the bakin skill,
  and the composed AGENTS.md section all render through it — bytes cannot
  drift between surfaces.
- The AGENTS.md managed block gains a `tool-access` section (between role and
  team) composed from the ACTIVE runtime in `resolveContextInputs`
  (`src/core/team-context.ts`). The lockfile records `toolAccessSha`; a
  runtime switch shows up as `tool-access`-attributed drift, auto-fixed by
  `bakin agents sync`.
- **Provisioning is adapter-owned**: `provisionToolAccess()` /
  `deprovisionToolAccess()` / `verifyToolAccess()`. OpenClaw writes/prunes
  `config.mcp.servers[bakin-<agent>]` internally (only entries tagged
  `Bakin MCP for <agent>` are ever pruned — a user's own `bakin-*` server
  survives). Entries carry `requestTimeoutMs: 600_000` — OpenClaw's MCP
  client default (60s) killed `bakin_exec_images_generate` mid-render in
  P5.3 live validation; verify flags timeout-less entries as incorrect so
  provisioning heals pre-timeout installs. Entries also carry
  `codex: { agents: [<agent>] }` — OpenClaw's per-server agent filter for
  Codex app-server threads (`isCodexMcpServerAllowedForAgent`). Without it,
  OpenClaw attaches EVERY `mcp.servers` entry to EVERY agent thread, so each
  of N agents carried N duplicate copies of Bakin's whole tool catalog per
  turn (live 2026-07: 10 agents x 134 tools = 1,340 tool entries per turn,
  vs 134 scoped). Verify flags unscoped entries as incorrect so provisioning
  heals pre-scoping installs; OpenClaw rotates the Codex thread
  automatically when its `userMcpServersFingerprint` changes. The scoping
  key applies to Codex app-server threads only — OpenClaw's embedded
  runtime has no per-agent server filter (its `mcp.servers` merge is
  agent-blind; only per-agent `tools.allow`/`deny` name globs filter
  materialized MCP tools there). Pi is a no-op (exec tools ride
  the `execTools` provider passed to `initialize`). Provisioning runs at server BOOT (`server.ts`), onboarding
  `install()`, and adapter roster changes — NEVER inside `createAppServices()`
  (a read-only CLI check must not write runtime config, and per-process env
  PORT derivation would flip-flop URLs). `BAKIN_MCP_BASE_URL` overrides the
  base URL (the dockerized rig needs `host.docker.internal`).
- mcporter is DELETED (module, onboarding component, health check, npm dep).
  The content transport-neutrality guard bans `mcporter`, `bakin-<agent>`,
  `media://`, `--args`, `--timeout N` in shipped content
  (`plugins/*/defaults/**`, `skill/SKILL.md`, `team-context-defaults.ts`).

## Runtime config is adapter-private

`config: RuntimeConfigAccess` is deleted from the contract. Every upstream
need crosses a neutral method:

| Need | Surface |
|---|---|
| tool-access wiring | `provisionToolAccess()` family |
| credential presence (onboarding llm/channels) | `credentialStatus()` — names only, never secrets |
| model routing policy (defaults/fallbacks/aliases/subagent defaults) | `models.routingPolicy()` / `setRoutingPolicy()` + `models.routingSupport()` (declares which knobs the runtime HONORS; unsupported patches are rejected, never silently stored). `RuntimeRoutingSupport.supportedThinkingLevels` declares which per-turn thinking levels the runtime honors (Pi: `off`…`xhigh`; OpenClaw: all 8 incl. `adaptive`/`max`) — Bakin's work-class thinking routes clamp-and-warn against it (`applyRoutingCapabilities`), never a silent drop. `RuntimeRoutingSupport.perTurnModel` (#880) declares whether `messaging.send/stream` turns may carry a per-turn `model` override, and MAY BE DYNAMIC: OpenClaw derives it from the gateway connection's GRANTED scopes (2026.9.5 gates overrides behind `operator.admin`; the adapter requests it as an OPTIONAL connect scope with ONE graceful downgrade re-dial on a refusing topology — downgrade fires only on approvedScopes evidence proving a scope-upgrade refusal, never on a base pairing failure — so the elevated request never regresses a working connection) plus an epoch-scoped mid-session denial (an admission rejection retries the turn once on the agent default with a `metadata.modelOverrideDenied` receipt and a fresh `-clamped` idempotency key, then flips the capability FOR THAT CONNECTION EPOCH — a reconnect whose ACK re-grants admin supersedes it, no restart needed; an ACK without `auth.scopes` verifies the requested set, so pre-scope-reporting gateways never sit "unverified" forever). `false` ⇒ `applyRoutingCapabilities` also drops routed models pre-send with a `modelClamp` receipt + a once-per-class-per-denial `route.model_clamped` audit; the `runtime.openclaw.override-authorization` health check goes action_required when model routes exist on an unauthorized connection. Conformance pins `perTurnModelHonesty` (declared-true must accept a model-carrying turn; honest-false is skipped). NEVER map the override rejection to `model_not_supported` — the model is healthy, the CALLER lacked authorization |
| per-agent model assignments | `agents.update({ model, subagentModel })` — null clears; OpenClaw persists into `agents.list[]`, Pi into its registry |
| account-callability probe (#852) | `models.probe?(modelId, { signal? })` — OPTIONAL member (the channels/cron pattern: feature-detect `models.probe?.`, never bare-deref). Fires a minimal (~1-token) completion; resolves on success, rejects typed (`model_not_supported` when the provider rejected the model id). Pi implements via `ModelRuntime.completeSimple` (no agent session, 20 s ceiling); OpenClaw omits. Billed and user-triggered only — never scheduled, never fired from background refresh |
| model reference resolution (#907 review) | `models.resolveId?(ref) → Promise<string \| null>` — OPTIONAL member (omit, never stub; conformance-pinned per adapter + honesty check + teeth). The catalog id the runtime would RUN `ref` as: the ref itself when listed verbatim, the adapter's OWN resolution of a non-verbatim reference (Pi: `findPiModel` — the same rule its turn path uses, so a bare id resolves to the first registry match and a wrong provider on a real id resolves to null), or null. The eligibility engine (`resolveCatalogId`) and the dispatch gate judge persisted selections by this; a runtime without it runs exactly what its catalog lists. Read-only, no network. Pi implements; OpenClaw and the mock omit |
| provider credential inventory (#907 / #378 model slice) | `credentials?.providers({ agentId? })` — OPTIONAL member (omit, never stub; conformance-pinned + teeth). Returns `{ providers: [{ providerId, configured, authFree?, source? }], evidence: 'complete' \| 'partial', detail? }` derived from the adapter's REAL auth resolution (Pi: `hasConfiguredAuth` per catalog provider + auth.json; OpenClaw: the merged auth-profiles JSON + `models auth list` CLI, `partial` when the CLI probe failed — today that failure was swallowed). STATUS ONLY: the conformance suite rejects any undeclared field on the inventory or an entry, and `tests/architecture/provider-inventory-shape.test.ts` pins the TypeScript shape against secret-shaped names. Consumed by the ONE eligibility engine (`src/core/model-eligibility.ts`); a partial inventory leaves absent providers UNKNOWN, never credential-less |
| per-model unavailability reason | `RuntimeAvailableModel.unavailableReason?: 'no_credentials' \| 'not_configured' \| 'other'` — WHY `available` is false when the runtime knows. Pi says `no_credentials` (its `available` flag IS auth presence); consumers never infer a reason the runtime did not give (absent ⇒ "runtime reports this model unavailable", never "retired") |
| restart advice (#878) | `restartAdvice?(kind: 'model-config' \| 'roster' \| 'routing-policy') → { needed, title?, body?, action?: { label, kind: 'restart-runtime' } }` — OPTIONAL, sync + static like `describeToolAccess()`. The Models/Team banners are dumb renderers of this; adapters without it get generic advice. Pi: `needed:false` for all (it re-reads its stores per turn — pinned by `tests/integration/pi/model-change-no-restart.test.ts`); OpenClaw: `roster` only (per-agent MCP servers attach at gateway start; model pins and `agents.defaults.*` hot-reload per the 2026-09-20 incident log). Persisted pending state lives in core (`src/core/pending-restart.ts`) and is cleared only by a successful `restart()` |
| roster integrity (onboarding runtime check) | `agents.list()` + adapter-resolved `metadata.workspacePath` |

Routing policy stays RUNTIME-owned (the runtime honors these knobs at session
time); round-trip preservation across switches is by construction — each
runtime's native store sits untouched while another is active.

## Main-agent resolution

The orchestrator is a runtime-declared fact resolved by
`selectRuntimeMainAgent` (`packages/core/src/adapters/runtime/helpers.ts`):
id `'main'` → role `'orchestrator'` → first agent. The id rung leads because
role text is fuzzy (agent packages can set it). No baked `'main'` defaults in
the dispatch builders; onboarding integrity requires a DECLARED orchestrator
(id or role), so a non-`'main'` orchestrator is fully supported.

## Runtime switch

`switchRuntime(target)` (`src/core/runtime-switch.ts`) is the first-class
lifecycle: validate → settings backup (`~/.bakin/.backups/`) → snapshot source
roster + workspace content + optional-surface counts → deprovision old → flip
settings → fresh app services on the target → provision → `reconcileRoster` →
workspace content carry → drift-gated agent re-projection → capability +
tool-access + can't-carry + credential report. Any failure before completion
restores the backup and rebuilds services on the original adapter. ALWAYS
switch via `bakin runtime use` (or the `/runtime` page) — hand-editing
`settings.runtime.adapter` skips every carry/provision step and is
unsupported.

- **Dry run (#625)**: `bakin runtime use <adapter> --dry-run` /
  `POST /api/runtime/switch { dryRun: true }` previews the ENTIRE report —
  would-carry roster, model + subagent-model mapping, workspace content
  counts, stays-behind lines, target credential status — with ZERO writes:
  no backup, no flip, no provisioning, no target-home mutation, no audit
  trace. The target is a read-only secondary adapter instance (the factory
  is pure and `initialize()` is write-free by conformance pin — seeding and
  config writes are provisioning concerns). One scoped exception: probing an
  OpenClaw TARGET shells its CLI, which lazily materializes internal state
  (`.openclaw/state/`, `.openclaw/identity/`) on any first read — the same
  lazy init `bakin check` triggers; never config/roster/workspace content.
  Teeth: `tests/integration/runtime-switch-dryrun{,-reverse}.test.ts`
  (byte-identical tree-hash assertions over real adapters, both directions,
  the reverse leg pinning the internal-state-only tolerance).
- **Carry-over matrix**: Bakin-owned state (tasks, assets, projects,
  workflows, Bakin schedules, budgets, usage history, chat transcripts,
  avatars, audit) carries automatically — the switch never touches
  `~/.bakin`, and agent ids are preserved so every reference keeps
  resolving. Runtime-owned state:
  - **Roster** — `reconcileRoster` (`src/core/roster-reconcile.ts`) creates
    missing agents on the target, maps models AND subagent models onto the
    target catalog (exact id, else UNIQUE bare-model match —
    `openai/gpt-5.5` ↔ `openai-codex/gpt-5.5`), and REPORTS unmapped models
    (agent falls to the target routing default — never guessed; subagent
    models also honor `routingSupport().perAgentSubagentModel`). Agents
    already on the target are untouched (round-trip preservation).
  - **Workspace content** — the `carry-workspaces` phase
    (`src/core/workspace-carry.ts`) copies canonical files (SOUL/IDENTITY/
    AGENTS/TOOLS incl. everything outside managed blocks) and `memory/*.md`
    verbatim for switch-created agents, and carries agent-authored skills
    through the neutral `runtime.skills` surface so they land where the
    TARGET reads skills (`skills/<name>/` on OpenClaw vs `.pi/skills/` on
    Pi). Package-managed skills (`installedBy` marker) are left to
    `agents sync` re-projection. Existing target agents are never written.
    Failures degrade to the `workspaces` report on a completed flip — never
    a rollback. Opt out: `--no-copy-workspaces`.
  - **Stays behind, honestly** — `cantCarry` lines
    (`src/core/switch-report.ts`): channels config and runtime-owned cron
    jobs (derived from the optional surfaces, best-effort counts; count 0
    emits nothing), runtime session context (chats keep their Bakin-owned
    transcripts), and provider-private config/credentials. The report also
    carries the TARGET's `credentialStatus()` — a carried roster with no
    provider auth dispatches nothing, so the preview warns before the flip.
- **Restart required**: plugins capture `ctx.runtime` at activation, so a
  completed switch returns `restartRequired: true`; everything durable happens
  before the restart.
- Surfaces: `bakin runtime` (capability report) /
  `bakin runtime use <adapter> [--dry-run] [--no-copy-workspaces] [--adopt-cron]` (CLI),
  `POST /api/runtime/switch { target, dryRun?, copyWorkspaces?, adoptCron? }` +
  `GET /api/runtime/capabilities` + `GET /api/runtime/onboarding` (REST),
  and the `/runtime` host page (capability matrix, confirm-to-switch, live
  progress via `runtime:switch` SSE events, carry/workspace/stays-behind/
  credential report, setup-status surfacing). e2e proof:
  `tests/integration/runtime-switch{,-e2e,-dryrun}.test.ts` — the AGENTS.md
  tool-access section genuinely flips per runtime through the real projector,
  drift-gated (a repeat leg is a projection no-op).

## Adding a runtime (the N-runtime checklist)

1. New `packages/adapter-<name>/` implementing `AgentRuntimeAdapter` —
   including `describeToolAccess`, `capabilities`, `credentialStatus`,
   `provisionToolAccess` family, `models.routingPolicy` family. Omit
   `channels`/`cron` if the runtime lacks them.
2. Register in `src/core/runtime-adapter-factory.ts` +
   `RuntimeAdapterName` (`packages/core/src/settings.ts`) +
   `RUNTIME_ADAPTER_NAMES` (`src/core/runtime-switch.ts`).
3. Make the runtime conformance suite green — it is the ACCEPTANCE GATE
   for any adapter (`tests/integration/runtime-conformance/`): one shared
   check module (`runtimeConformanceChecks`) run by one thin runner per
   target (dev mock, Pi over the fake provider, OpenClaw over the
   Imitation Crab gateway). Pins: threaded sends return
   `metadata.sessionId`; abort settles `kind:'aborted'` clean; messaging
   errors are typed `RuntimeError`s (kind, never message text); stream
   taxonomy (classified chunks, structured tool data, `done`
   exactly-once-and-last, error chunk + no throw); `onActivity` tap;
   capability honesty (declared mode ⇒ working surface, both directions —
   e.g. `delivery: 'native'` ⇔ `channels` present); provisioning
   idempotency; nonexistent-id `agents.update`/`agents.remove` reject
   `kind:'not_found'` (reads return null; workspace-file writes provision
   on demand by design); `streamDoneCarriesUsageWhereSendDoes` — the
   `done` chunk variant carries `usage?: MessageUsage`, and a runtime
   whose `send()` results report usage MUST attach it to stream `done`
   (Pi computes a session-stats delta; OpenClaw threads its RPC result
   usage through the chunk machine) — chat metering depends on it;
   `thinkingLevelHonesty` — every level declared in
   `routingSupport().supportedThinkingLevels` must serve a clean turn;
   `sessionOriginLabelsAreHonest` (#691) — a runtime exposing a
   `session_jsonl` memory tier must label session entries' `metadata.origin`
   from `{bakin, external, unknown}`, and the transcript of a threaded Bakin
   send — when listed — must be `bakin` (Pi labels via `bakin-threads.json`
   membership with its OWN error channel: missing map = external, corrupt
   map = unknown; OpenClaw via sessions.json key shapes + deterministic v5
   uuids — files predating a reset/rotation miss the store lookup and
   classify by uuid version (v5 = bakin, v4 = rotated interactive), so a
   /reset never converts the user's own chats into an unexplained-usage
   alarm; subagent sessions are runtime-spawned child work = bakin).
   Runtimes without the tier or without per-turn transcript persistence
   conform vacuously — never mislabel.
   `teeth.conformance.test.ts` proves the checks
   reject violators (incl. per-lie adapters for the two routing pins) — a
   new runner is three target hooks, not new checks.
4. Nothing else: prompts, AGENTS.md sections, provisioning, onboarding
   checks, the switch, and the management page all derive from the contract.

**Static capability declarations are legal only when the surface is
unconditionally implemented** — declaring `sessions: 'native'` over a stub
was the audit's M1 dishonesty; T28 restored the standard by implementing
real `sessions.list/get` on OpenClaw (store-mapped, mtime-cached).

**`sessions.contextStats?` (#737)** — optional member (the cron/storeStats
presence-is-the-contract pattern): `contextStats({agentId, threadId})` →
`RuntimeSessionContextStats | null` — a session's context reading, runtime
truth only, read AT REST (no gateway calls, no session mutation, no thread
locks; keyed on threadId because the thread→session map is adapter-private).
Null-honesty IS the contract: `tokens: null` = honestly unknown (post-
compaction gap, stale store), `compactionThreshold: null` when the runtime
owns compaction opaquely (codex-native), null result for unmapped threads.
**Billing aggregates are a BANNED source** — run_costs usage sums across a
turn's internal tool-loop requests (the 109% incident; post-mortem in
`.claude/specs/chat-turn-usage.md` D1). Pi: file-only SDK-parity read
(`packages/adapter-pi/src/context-stats.ts` — last valid assistant
usage.totalTokens + chars÷4 tail, INDEX-based compaction guard (never
timestamp comparison: real message timestamps are epoch-ms numbers,
compaction entries ISO strings — a string/number compare was the one
Critical caught in review), threshold = window − reserveTokens, results
mtime+size-cached per file — session JSONL grows forever and this runs
per chat GET). Pi SDK upgrade checklist: the adapter re-implements the
SDK's unexported estimateContextTokens — re-verify against
getContextUsage on every pi-coding-agent bump. OpenClaw: pure sessions.json read
(`packages/adapter-openclaw/src/context-stats.ts` — totalTokens gated on
totalTokensFresh, an over-window total reads null (incoherent — never a
clamped 100%), window from contextTokens, threshold ONLY from a
runtime-written contextBudgetStatus with a ≤-window coherence guard; the
trajectory is never read).
Conformance pins declaration honesty + sane values (tokens ≤ window; a
lying adapter fails the teeth) and
`tests/architecture/no-billing-derived-context.test.ts` scans every
adapter context-stats module for spend-source imports; mock declares
'absent', Imitation Crab writes the store fields (+ the
`[[stale-context]]` marker for the fresh:false path) so the OpenClaw
runner exercises it end-to-end. External plugins see the surface via the
SDK's optional `sessions` declaration (packages/sdk/src/types/runtime.ts).
Consumer: chat's compaction bar (kit `ContextMeter`).

**Specified contract semantics (T29/T30):** `ping()` = "can serve a turn,
cheaply probed" (Pi checks initialized + ≥1 LLM credential — never an LLM
call); `restart()` = "re-read all durable config"; `MessageArgs.toolsAllow`
/`toolsDeny` scope Bakin EXEC TOOLS only (native tool policy is
adapter-private via `toolsMode`; OpenClaw warns-and-ignores since MCP
servers are session-static); `MessageArgs.oversizedOutputBytes` is a typed
field (no metadata bag) honored by both adapters' turn diagnoses;
`updatePermissions` and `tools.invoke` are DELETED (dead surface);
`agents.updateAllowlist` patches AGENT IDS (the subagent-dispatch
allowlist — see the contract doc, born of the P5.3 conflation below).

## Known deferred items (plan addenda)

- Dockerized rig still bridges via mcporter config — re-plumb onto
  `BAKIN_MCP_BASE_URL` + adapter provisioning (gates P5.3 rig use).
- ~~Long image generation over OpenClaw's NATIVE MCP client is unvalidated~~
  Validated live in P5.3: OpenClaw's 60s MCP client default timed out
  `bakin_exec_images_generate` (gpt-image-2) mid-render; fixed by
  provisioning `requestTimeoutMs: 600_000` per server entry (mcporter
  budget parity). The idempotent image tool prevented a double-bill during
  the agent's honest retry.

## P5.3 live findings (this box)

- **Pi allowlist/tool-filter conflation**: `agents.updateAllowlist` records
  the SUBAGENT dispatch allowlist (agent ids — installer adds every package
  agent to main's list), but the Pi session builder fed that field to the
  exec-tool filter as tool names → main silently lost every `bakin_exec_*`
  tool. Fixed + regression-pinned (`tests/adapter-pi/tool-bridge.test.ts`).
  The contract now states the semantics on `updateAllowlist` itself (agent
  ids, per-adapter storage documented) — the incident class is closed at
  the type/doc level, not just patched.
- Installed agent packages from `bakin-bits-official-private` (nemo/zen/
  scout) and the `projects` plugin carried mcporter invocation forms —
  neutralized at source (0.2.1 / 0.5.2+1.0.1) and re-synced. Shipped-repo
  guards can't see installed content; watch for this on other boxes.

## pi-parity additions (P3/P4, 2026-07-13)

- **Subagent-model preservation**: carrying onto a runtime with
  `perAgentSubagentModel: false` STASHES the value in agent metadata
  (`carriedSubagentModel`, reconciler-owned, stripped from normal metadata
  carry) and reports `preserved`; the switch back restores it (mapped +
  applied via `agents.update`, stash consumed). Capability flags stay
  honest — unsupporting runtimes never receive a subagentModel update.
- **Cron adoption (opt-in)**: `--adopt-cron` captures the source's native
  cron jobs (list + per-job `getRaw`) during `snapshot-roster` — the one
  window before teardown — and a new `adopt-cron` phase (after
  `reconcile-roster`) hands them to the schedule plugin's
  `schedule.adoptCronJobs` hook: Bakin jobs with `source: 'adopted'` +
  `originalRuntimeCron` snapshot, idempotent per job id, dry-run previews.
  `RuntimeSwitchResult.cron = { adopted, skipped, failed }`; the can't-carry
  cron line folds the outcome in.
- **Extension trust lane (WS4)** — `extensions?: RuntimeExtensionsAccess`
  optional contract member (inert `list()`; Pi implements, mock/OpenClaw
  omit). Trust mutations live in ONE engine (`src/core/runtime-extensions.ts`)
  surfaced via REST + CLI + the hub's Extensions section + the adapter's
  `pi.extensions` doctor check. Pi's load default is allowlist-empty.
- **The /runtime page is the runtime hub** (`packages/host/src/routes/
  runtime.tsx` + `components/runtime/`): Overview (plain-language capability
  grid + legend + credential/tool-access tiles + live setup checks),
  Capabilities (capability-pack readiness, remediation links; installs stay
  in Explore), Runtimes (roster cards on the capability-card anatomy;
  clicking a runtime opens the ConfirmDialog which owns the WHOLE switch
  flow — options, consequences, preview trigger, typed confirm — per the
  no-inline-actions rule; dry-run preview results render on the page,
  live SSE steps, grouped result cards). Unknown ?tab= values fall back
  to Overview.

## concurrency.sameAgentTurns (same-agent concurrency)

REQUIRED `CapabilitySet` member: `'isolated'` (adapter honors `MessageArgs.runWorkspace` per-turn
cwd — Pi) or `'serialized'` (cannot isolate — OpenClaw, default mock; dispatch clamps that agent
to 1 turn with an audit receipt). Conformance: `sameAgentIsolationHonesty` requires a
declared-isolated target to prove it via `prepareIsolatedTurnProbe` (two CONCURRENT turns leave
traces in the two handed dirs; probeless isolated declarations FAIL) + teeth. Mock opt-in:
`withMockIsolation(createMockRuntimeAdapter())`. Deep reference:
`.claude/knowledge/same-agent-concurrency.md`.
