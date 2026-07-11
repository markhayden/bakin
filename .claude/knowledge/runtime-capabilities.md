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
| `delivery` | native / shimmed / unavailable | Pi: unavailable (no channel layer) |
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
| model routing policy (defaults/fallbacks/aliases/subagent defaults) | `models.routingPolicy()` / `setRoutingPolicy()` + `models.routingSupport()` (declares which knobs the runtime HONORS; unsupported patches are rejected, never silently stored) |
| per-agent model assignments | `agents.update({ model, subagentModel })` — null clears; OpenClaw persists into `agents.list[]`, Pi into its registry |
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
roster → deprovision old → flip settings → fresh app services on the target →
provision → `reconcileRoster` → drift-gated agent re-projection → capability +
tool-access report. Any failure restores the backup and rebuilds services on
the original adapter.

- **Carry-over matrix**: Bakin-owned state (tasks, assets, projects,
  workflows, Bakin schedules, chat, audit) carries automatically — the switch
  never touches `~/.bakin`. The roster is the one runtime-owned migration:
  `reconcileRoster` (`src/core/roster-reconcile.ts`) creates missing agents on
  the target, maps models onto the target catalog (exact id, else UNIQUE
  bare-model match — `openai/gpt-5.5` ↔ `openai-codex/gpt-5.5`), and REPORTS
  unmapped models (agent falls to the target routing default — never guessed).
  Agents already on the target are untouched. Deep carry-over polish slots
  into this seam (#625+).
- **Restart required**: plugins capture `ctx.runtime` at activation, so a
  completed switch returns `restartRequired: true`; everything durable happens
  before the restart.
- Surfaces: `bakin runtime` (capability report) / `bakin runtime use <adapter>`
  (CLI), `POST /api/runtime/switch` + `GET /api/runtime/capabilities` +
  `GET /api/runtime/onboarding` (REST), and the `/runtime` host page
  (capability matrix, confirm-to-switch, live progress via `runtime:switch`
  SSE events, carry report, setup-status surfacing). e2e proof:
  `tests/integration/runtime-switch{,-e2e}.test.ts` — the AGENTS.md
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
   idempotency; nonexistent-id mutations reject `kind:'not_found'`
   (reads return null). `teeth.conformance.test.ts` proves the checks
   reject violators — a new runner is three target hooks, not new checks.
4. Nothing else: prompts, AGENTS.md sections, provisioning, onboarding
   checks, the switch, and the management page all derive from the contract.

**Static capability declarations are legal only when the surface is
unconditionally implemented** — declaring `sessions: 'native'` over a stub
was the audit's M1 dishonesty; T28 restored the standard by implementing
real `sessions.list/get` on OpenClaw (store-mapped, mtime-cached).

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
