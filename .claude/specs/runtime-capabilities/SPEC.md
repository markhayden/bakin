# Spec: Runtime Capability Foundation

Status: **interview complete, awaiting approval** · Owner: roscoe · Date: 2026-07-07
Branch: `feat/tool-access-neutral` (off `feat/adapter-pi`) · Supersedes the narrower "transport-neutral tool-access" framing

## Objective

Give the runtime-adapter contract a **single, uniform way to express**: *"Bakin needs capability X; this runtime provides it natively / via a Bakin-owned shim / not at all,"* and *"here is how this runtime makes Bakin's tools callable by its agents."* Today those two questions are answered by **five different ad-hoc mechanisms** with OpenClaw transport logic leaking into core — which forces bespoke per-capability surgery every time a new runtime lands (proven: Pi's image support needed reactive heroics). This builds the foundation so runtimes #3 (Hermes) and #4+ map on by **declaring their capability matrix**, not by editing core.

Tool-access is the **reference capability** (kills mcporter, the two-month-old bootstrap artifact); images is retrofitted as the **second conformant capability** (proving the abstraction generalizes across two structurally-different runtimes). Switching runtimes becomes a **first-class, reversible operation** from CLI + UI that automates all the heavy lifting.

Runtime priority order this must serve: **1 OpenClaw, 2 Pi, 3 Hermes, 4+ others.** Architecture is the deliverable; no sacred cows; crush the debt.

## Decision Record

### Round A — original tool-access interview (still in force)
D1 spike-first (broadened, see D21) · D2 full mcporter delete + keep `cli-shim` inert · D3 branch off adapter-pi · D4 adapter=facts/Bakin=prose, one renderer · D5 `describeToolAccess` folds into the capability descriptor (was: becomes required) · D6 drop native tool cheat-sheet · D7 doctor warn + explicit sync **(superseded by D20/the switch command owning re-sync)** · D8 runtime/style in lockfile `ProjectionInputs` · D9 mass re-sync expected · D10 chat relies on synced AGENTS.md · D11 unify ALL authoring sites · D12/D13 package-layer neutralize at compose + fix bits source · D14 spike flips box to OpenClaw · D15 spike bar = full task, zero regressions · D16 enum `'in-process' | 'mcp' | 'cli-shim'` · D17 extend `team.agent-sync` doctor check · D18 neutral role defaults + injected section.

### Round B — capability-foundation reframe
| # | Decision | Choice |
|---|----------|--------|
| D19 | Scope of this PR | **Foundation + switch UX + images retrofit.** Phase 1 capability/provisioning foundation + tool-access reference + mcporter delete + content guard; Phase 2 full contract cleanup; Phase 3 runtime-switch CLI+REST+UI; Phase 4 images retrofit. Channels-shim named as a follow-up. |
| D20 | Contract cleanup depth | **Full, now.** `capabilities(): CapabilitySet` (unified, supersedes modality-only); adapter-owned provisioning lifecycle; channels/cron → **optional** blocks (feature-detected, not required-that-throws); the whole-`config` assumption narrowed to declared capability methods. Hermes maps on with **zero contract changes** later. |
| D21 | Spike | **First, but broadened** — validate the adapter-owned provisioning + native-MCP instruction path end-to-end on OpenClaw (priority 1), not just the transport. Gates mcporter deletion. |

Standing constraints: reduce tech debt; **no backwards-compat/migration** (re-sync is the path); single-user box; small files; docs (`.claude/knowledge` + README + CLAUDE.md) in-PR; checkpoint commits per phase.

## The model

Two orthogonal adapter responsibilities, made uniform:

### 1. Capability declaration — `capabilities(): CapabilitySet`
For every capability with a native/shim/gap choice, the adapter declares a mode + facts:

```ts
type CapabilityMode = 'native' | 'shimmed' | 'unavailable'
interface CapabilitySet {
  toolCalling: { mode: 'native'; access: RuntimeToolAccess }   // always reachable via provisioning
  delivery:    { mode: CapabilityMode; ... }   // channels + approvals
  imageGen:    { mode: CapabilityMode; ... }   // native / Bakin shim / gap
  input:       { imageInput: boolean; audioInput: boolean }   // folds in today's capabilities()
  // ...one entry per capability that has a native/shim/gap decision
}
interface RuntimeToolAccess {
  style: 'in-process' | 'mcp' | 'cli-shim'
  mcpServerTemplate?: string   // 'mcp' → 'bakin-<agent>'
  shimCommand?: string         // 'cli-shim' only
  example?: string
}
```

Bakin consumes ONE descriptor to: render agent instructions (tool-access first), route to shims when `shimmed`, degrade honestly + surface in UI when `unavailable`, and let **plugins query capability status instead of assuming** (extensibility, lens 4). Validated against OpenClaw (external) + Pi (in-process); designed with Hermes (external, no config document, messaging-gateway/Python-RPC) as the stress test. Always-Bakin-owned capabilities (scheduling, heartbeats) stay OUT of the descriptor — they have no native/shim choice.

### 2. Provisioning lifecycle — in the adapter
```ts
provisionToolAccess(execTools: RuntimeExecToolProvider): Promise<void>   // make Bakin tools reachable
deprovisionToolAccess(): Promise<void>                                    // switch tear-down
```
- **Pi**: the in-process bridge it already has (no-op beyond that).
- **OpenClaw**: its MCP-config writing (`bakin-<agent>` entries, `?agent=` URL scheme) **relocated from `src/core/{mcporter,openclaw-integration}.ts` INTO `packages/adapter-openclaw`**; mcporter deleted.
- **Core keeps ZERO runtime-specific provisioning.** New runtime = new adapter, no core edits.
- Reads the **live** `getAllExecTools()`, so a newly-installed plugin's tools provision without a manual step. Live-create of an *agent* also triggers provision — closes the boot-only re-sync gap the audit found.

### 3. Contract cleanup (D20)
- `channels`, `cron` → **optional** contract blocks. Pi *omits* them (drops its throwing `unsupported.ts` stubs); every consumer feature-detects (`runtime.channels?`, `runtime.cron?`). A thin runtime never implements a block just to throw.
- Whole-`config: RuntimeConfigAccess` assumption narrowed: provisioning uses **adapter-private** config (OpenClaw's own file), never the contract; onboarding credential checks move to a declared `credentialStatus()` capability method (Pi synthesizes, OpenClaw reads its config, Hermes reports what it can). The governed whole-config get/replace gate + `runtime-config-raw` collapse toward that.
- `describeToolAccess`'s `'mcporter-cli'` literal (OpenClaw transport baked into the contract) → folded into `RuntimeToolAccess.style`.

### 4. Runtime switch — first-class lifecycle (lens 3)
`bakin runtime use <adapter>` (CLI) + `POST /api/runtime/switch` + UI toggle, orchestrating: **backup settings → flip → deprovision old → provision new → re-project agents (sync) → re-validate capabilities → honest report of native/shimmed/unavailable → reload.** Reversible via the backup. This is the explicit action that legitimizes rewriting workspace files (resolves the D7 manual-sync tension) and automates the heavy lifting.

### 5. Content transport-neutrality guard (lens 4)
Arch test bans transport strings (`mcporter`, `bakin-<agent>`, raw `media://`) in shipped agent/plugin content (`plugins/*/defaults/**`, `team-context-defaults.ts`, package manifests); install/sync verify rejects content carrying transport. Everything renders through the one renderer. Combined with the live registry seam = how new plugins/bits tie in automatically.

## Phased build (checkpoints = commits)

- **Phase 0 — Spike (D21):** flip box to OpenClaw; hand-inject native-MCP-only instructions + a prototype adapter-provisioned path; run a full real task; confirm ≥2 native `bakin_exec_*` calls via MCP, zero regressions vs mcporter. Pass → plan commits to deletion. **Gate.**
- **Phase 1 — Foundation:** `CapabilitySet` + `RuntimeToolAccess`; `provisionToolAccess`/`deprovision`; relocate OpenClaw provisioning into its adapter; delete mcporter (module, onboarding component, npm dep, `~/.mcporter`); `renderToolAccessInstructions` (one home); neutral role defaults + injected section; content guard; runtime field in lockfile + runtime-aware `team.agent-sync`.
- **Phase 2 — Contract cleanup:** channels/cron optional + feature-detect consumers; `credentialStatus()`; collapse config gates; drop Pi's throwing stubs.
- **Phase 3 — Runtime switch:** `bakin runtime use` CLI + REST + UI toggle + capability report.
- **Phase 4 — Images retrofit:** images onto `CapabilitySet.imageGen` (native/shimmed/unavailable) — second conformant proof; Pi codex/shim + OpenClaw native both map on the model.
- **Phase 5 — This-box validation:** re-sync roster (native instructions), flip Pi back, chat clean, full suite green, live switch OpenClaw↔Pi round-trip.

## Testing Strategy

- Renderer + composition unit tests (three styles; neutral role defaults; injected section; package neutralize).
- Capability-descriptor conformance: mock + both adapters return a valid `CapabilitySet`; contract tests updated; feature-detect paths covered (channels/cron absent).
- Drift: two runtime styles → byte-different blocks → `scan` reports runtime-attributed `block-stale`; lockfile carries style.
- Provisioning: relocated OpenClaw provisioning writes the same config it did from core (golden); Pi bridge unaffected; live plugin-install + live agent-create both provision.
- Content-guard arch test: fixture with `mcporter`/`bakin-<agent>`/`media://` fails; clean tree passes.
- Runtime-switch integration: OpenClaw↔Pi round-trip re-provisions + re-projects + re-validates; reversible; capability report correct.
- Dispatch byte fixtures regenerated (native rendering); #357 budget green (AGENTS.md smaller).
- Live acceptance (Phase 5) recorded in the PR.

## Boundaries

- **Always:** adapter returns facts (no Bakin prose in adapters); core has zero runtime-specific provisioning; one renderer; capability queried, never assumed; re-sync not migration; docs in-PR; per-phase checkpoints.
- **Ask first:** keeping OpenClaw on `cli-shim` (spike fail — changes deletion scope); any change to agent-package ownership beyond compose-neutralize + bits source fix; the `credentialStatus()`/config-collapse shape if it churns more than the onboarding checks.
- **Never:** delete mcporter before the spike passes; leave a hardcoded transport string in any authoring/content site; auto-rewrite workspaces outside the explicit switch/sync action; backwards-compat shims; a new capability handled by a sixth ad-hoc mechanism (must go through `CapabilitySet`).

## Success Criteria

1. `capabilities(): CapabilitySet` is the single capability declaration; `RuntimeToolAccess` folds in `describeToolAccess`; Pi=`in-process`, OpenClaw=`mcp`, `cli-shim` inert.
2. Provisioning is adapter-owned; **core has zero runtime-specific provisioning code**; mcporter fully deleted; `bakin --help`/onboarding no longer mention it.
3. One `renderToolAccessInstructions` feeds role composition + dispatch + workflow + skill; **grep-clean of hardcoded transport strings** across repo + shipped content; content-guard arch test green.
4. channels/cron optional + feature-detected; Pi omits them (no throwing stubs); config assumption narrowed to `credentialStatus()`; a thin runtime implements only what it has.
5. `bakin runtime use <adapter>` (CLI+REST+UI) round-trips OpenClaw↔Pi: re-provision + re-project + re-validate + honest capability report; reversible; no manual steps.
6. Images expressed through `CapabilitySet.imageGen` (2nd conformant capability); Pi codex/shim + OpenClaw native both map on the formal model.
7. Package/plugin content neutralized at compose; bits-official source issue filed/fixed; new plugin tools + new agents auto-provision live.
8. Spike passed (or OpenClaw documented as staying `cli-shim`, deletion scoped down). This box re-synced to native, Pi chat clean, full suite green.

## Open Questions (react on spec review; resolved in plan)

- Exact `CapabilitySet` member list — which capabilities get an entry vs stay Bakin-owned-and-out (recommend: only those with a native/shim/gap choice).
- `credentialStatus()` shape vs keeping a minimal `config.raw` gate for onboarding — how far the config collapse goes without churning beyond onboarding.
- `'main'`-agent literal + `media://`-in-content: address `media://` in the content guard now; treat the `'main'` invariant as a separate tracked debt item (cross-cutting) unless it blocks Hermes.
- Switch UX UI depth: CLI+REST as the primitive now + a minimal UI toggle — confirm expected polish.
