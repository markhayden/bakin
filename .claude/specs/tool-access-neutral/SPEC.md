# Spec: Transport-Neutral Agent Tool-Access

Status: **interview complete, awaiting approval** · Owner: roscoe · Date: 2026-07-07
Branch: `feat/tool-access-neutral` (off `feat/adapter-pi`)

## Objective

Agents should be told to **call their `bakin_exec_*` tools** — never taught the transport plumbing (`mcporter call bakin-<agent>.<tool>`). Today the tool-invocation instructions are authored in two disjoint worlds: the **ephemeral dispatch prompt** is already runtime-aware (`describeToolAccess`/`resolveToolInvocation`), but the **durable projected workspace content** (`AGENTS.md` via the layered-context `role` layer) hardcodes mcporter. Chat turns rely entirely on that durable content, so agents shell out via `bash`+`mcporter` even on Pi where the tools are natively in-process — producing double-wrapped, error-prone, ugly results.

This makes tool-access instructions **derive from the active runtime adapter** through one shared renderer feeding both surfaces, adds runtime-aware sync-drift + a doctor fix, and **deletes the mcporter dependency entirely** — a two-month-old bootstrap artifact from before OpenClaw's native MCP config existed (mcporter 2026-03-26 vs native MCP config 2026-05-24).

Success: on Pi, agents call `bakin_exec_*` as in-process tools (no bash, no mcporter, clean results); on OpenClaw, agents call them via native MCP; mcporter tooling is gone; switching `settings.runtime.adapter` cleanly drifts the roster and one `bakin agents sync` re-projects; `cli-shim` survives as an inert extension point for a future shim-needing runtime.

## Decision Record (interview, 2026-07-07)

| # | Decision | Choice |
|---|----------|--------|
| D1 | OpenClaw native-MCP verification | **Separate spike FIRST** (before finalizing the plan), so the plan can commit to unconditional mcporter deletion. Spike fail → OpenClaw stays `cli-shim`, mcporter survives, only Pi goes in-process. |
| D2 | mcporter gutting depth | **Full delete** (`mcporter.ts`, onboarding component, `npm i -g mcporter`, `~/.mcporter` sync, all prose) **+ keep `cli-shim` as an inert enum style** + renderer branch (extension point; no npm dep). |
| D3 | Branch | New `feat/tool-access-neutral` off `feat/adapter-pi` — own PR, own checkpoint ladder (blast radius spans core layered-context + OpenClaw + Pi). |
| D4 | Descriptor shape | **Structured facts, Bakin renders.** Adapter returns a descriptor; ONE core `renderToolAccessInstructions(descriptor)` produces prose for every consumer. |
| D5 | `describeToolAccess()` | **Becomes REQUIRED** on the contract (load-bearing for what agents get told; no silent-wrong default). |
| D6 | Native tool cheat-sheet | **Dropped on `in-process`/`mcp`** — native tools self-describe via JSON schema. Short "call your `bakin_exec_*` tools directly" + discipline lines instead (startup-context #357 win). `cli-shim` keeps the full invocation cheat-sheet. |
| D7 | Doctor behavior | **Warn + explicit `bakin agents sync`**, never auto (re-projection mutates workspace files — stays user-invoked, consistent with existing agent-sync repair). |
| D8 | Provenance | **Add runtime/style to the lockfile `ProjectionInputs`** (per-file, alongside `roleSha`). No marker inside the managed block. |
| D9 | Mass re-sync on ship | **Expected + part of the acceptance test.** Shipping flips OpenClaw→`mcp` + Pi→`in-process`; all mcporter-composed blocks correctly drift; one `bakin agents sync` re-projects. No migration code. |
| D10 | Chat turns | **Rely on synced `AGENTS.md` only** — no extra tool-access injection in the chat/messaging path. |
| D11 | Authoring sites | **Unify ALL through the one renderer**: role layer (`team-context-defaults.ts`), `dispatch-prompts.ts`, `dispatch-workflow.ts`, `bakin-skill.ts`. Zero hardcoded mcporter strings survive. |
| D12/D13 | Package layer | **Audit + strip.** Compose-time transport-neutralizing pass over package-layer content (non-destructive, works for already-installed packages) **+ fix bakin-bits-official source** so fresh installs are clean. Layering rule: packages describe WHAT tools do; the role/tool-access layer owns HOW to call them. |
| D14 | Spike environment | **Flip the box back to OpenClaw temporarily** (bootstrap gateway, settings→openclaw), run the spike, flip back to Pi. Careful state handling — the Pi daily driver is disrupted for the duration. |
| D15 | Spike pass bar | **Full real OpenClaw task end-to-end** (create→work→assets→complete) on native-MCP-only instructions, calling ≥2 distinct `bakin_exec_*` tools via the MCP client, **zero regressions vs the mcporter path** — no bash shell-out, no double-wrap, results land clean. |
| D16 | Enum vocabulary | **`'in-process' | 'mcp' | 'cli-shim'`** (rename Pi's current `'native'`). Unambiguous vs the `native`/`native-mcp` confusion. |
| D17 | Doctor check | **Extend the existing `team.agent-sync` check** to a runtime-aware finding — no new check, one repair path. |
| D18 | Role defaults | **Neutral `ROLE_DEFAULTS` + injected tool-access section.** Strip ALL invocation prose from the role defaults so the role file is transport-neutral and STABLE (freshness check never misfires); the runtime-specific instructions become a NEW section injected at compose time from the renderer. |

Standing constraints: reduce tech debt; **no backwards-compat / migration** (re-sync is the path); single-user box; keep files small; `.claude/knowledge` + README + CLAUDE.md updated in-PR.

## Architecture

```
runtime adapter.describeToolAccess()  →  RuntimeToolAccess {
   style: 'in-process' | 'mcp' | 'cli-shim'
   mcpServerTemplate?: string        // 'mcp' → 'bakin-<agent>' (namespacing the agent sees)
   shimCommand?: string              // 'cli-shim' → the shell command template
   example?: string                  // one canonical call, style-appropriate
}
        │
        ▼
  renderToolAccessInstructions(descriptor)   ← THE single prose home (core)
        │
        ├─→ layered-context compose  (resolveContextInputs → new tool-access section)  [DURABLE: AGENTS.md]
        ├─→ dispatch-prompts.ts                                                          [EPHEMERAL]
        ├─→ dispatch-workflow.ts                                                         [EPHEMERAL]
        └─→ bakin-skill.ts                                                               [seeded skill]
```

- **Adapter = facts, Bakin = prose** (boundary-correct; endorsed by `adapter-architecture.md`). `in-process` (Pi), `mcp` (OpenClaw, pending spike), `cli-shim` (inert extension point).
- **Compose insertion point:** `resolveContextInputs` / `deriveExpectedBlocks` (`sync-scanner.ts`) — reachable at compose time via `getAppServices().runtime`. Role defaults stay neutral (D18); the tool-access section is injected here from the descriptor.
- **Drift is free:** composition already recomposes + byte-compares. A runtime switch changes the injected section → auto-drift. The lockfile runtime field (D8) makes it attributable.
- **Package neutralization:** a compose-time pass strips invocation-transport lines from package-layer content (D12/D13).

## Tech Stack / Structure (surfaces touched)

```
packages/core/src/adapters/runtime/concepts.ts     RuntimeToolAccess (widen) + describeToolAccess REQUIRED
packages/core/src/adapters/runtime/testing.ts       mock returns a style (tests updated)
packages/adapter-pi/src/runtime.ts                  'native' → 'in-process'
packages/adapter-openclaw/src/runtime.ts            'mcporter-cli' → 'mcp' (post-spike) [+ mcpServerTemplate]
src/core/tool-access.ts (NEW)                        renderToolAccessInstructions(descriptor) — the ONE renderer
src/core/team-context-defaults.ts                    strip ALL mcporter prose; role defaults neutral
src/core/agent-packages/composer.ts + sync-scanner   inject tool-access section; package-neutralize pass
packages/core/src/agent-packages/lockfile.ts         ProjectionInputs gains runtime/style
src/core/dispatch-prompts.ts, dispatch-workflow.ts   render via the shared renderer (drop mcporterHelpers)
src/core/bakin-skill.ts                              render via the shared renderer
plugins/team/lib/health-checks.ts                    team.agent-sync finding: runtime-aware message
DELETE: src/core/mcporter.ts, src/core/onboarding/mcporter.ts, ~/.mcporter sync, npm dep, COMPONENT_ORDER entry
tests/fixtures/dispatch-prompts/*                    regenerate (native rendering)
tests/fixtures/tool-access/* (NEW)                   golden rendered blocks per style
docs: .claude/knowledge/{layered-context,adapter-architecture,pi-adapter,dispatch}.md, CLAUDE.md, README
```

## Testing Strategy

- **Renderer unit tests**: `renderToolAccessInstructions` for all three styles (in-process drops the cheat-sheet; mcp names the server; cli-shim keeps full syntax); golden fixtures.
- **Composition tests**: role defaults are transport-neutral; the injected tool-access section matches the descriptor; package-neutralize pass strips mcporter from a fixture package TOOLS.md.
- **Drift tests**: composing under two different runtime styles yields byte-different blocks → `scan` reports `block-stale` with runtime attribution; lockfile carries the style.
- **Contract tests**: `describeToolAccess` required — mock + both adapters return a valid style; arch/contract conformance updated.
- **Dispatch byte fixtures**: regenerated for native rendering; measurement==production (context-report) holds; AGENTS.md shrinks (assert the #357 budget still passes).
- **The spike (D14/D15)**: manual, throwaway — flip box to OpenClaw, hand-inject native-MCP instructions into one agent, dispatch a full task, confirm ≥2 native MCP tool calls + zero regressions. Gates the plan's deletion commitment. Recorded in the plan/PR.
- **Live acceptance on this box**: after ship, `bakin agents doctor` flags all 10 agents drifted (runtime X→Y); `bakin agents sync` re-projects; a Pi chat turn shows clean native tool calls (no bash/mcporter).

## Boundaries

- **Always:** adapter returns facts only (no Bakin prose in adapter packages); one renderer for every surface; role defaults transport-neutral; re-sync (never migration); `.claude/knowledge` + README + CLAUDE.md in-PR; checkpoint commits.
- **Ask first:** anything that would keep OpenClaw on `cli-shim` (i.e. spike fails) — changes the deletion scope; touching agent-package ownership beyond the compose-time neutralize + the bits source fix.
- **Never:** delete mcporter before the spike passes (D1/D15); leave a hardcoded mcporter string in any authoring site (D11); auto-rewrite workspace files without an explicit sync (D7); backwards-compat shims.

## Success Criteria

1. `describeToolAccess()` required; Pi=`in-process`, OpenClaw=`mcp`, `cli-shim` retained as inert style.
2. One `renderToolAccessInstructions` feeds role composition + dispatch + workflow + skill; **zero hardcoded mcporter strings** remain in the repo (grep-clean).
3. Projected `AGENTS.md` on Pi tells agents to call `bakin_exec_*` directly; the exhaustive cheat-sheet is gone (AGENTS.md smaller; #357 budget green).
4. Runtime switch → all agents drift with a runtime-attributed `team.agent-sync` finding; `bakin agents sync` re-projects; lockfile records the style.
5. mcporter fully deleted (module, onboarding component, npm dep, config sync); `bakin --help` + onboarding no longer mention it; boundary/arch tests green.
6. Package-layer content neutralized at compose; bits-official source issue filed/fixed.
7. **Spike passed**: real OpenClaw task end-to-end on native MCP, zero regressions (or, if failed, OpenClaw documented as staying `cli-shim` and mcporter retained — scope adjusts).
8. This box: roster re-synced to native, a Pi chat turn shows clean tool calls, full suite green.

## Open Questions (resolved during build)

- Exact native-MCP tool-call form OpenClaw exposes (bare `bakin_exec_foo` vs namespaced) — **the spike determines it**, and it feeds `mcpServerTemplate`/the mcp renderer.
- Whether `bakin-skill.ts`'s seeded skill needs its own style branch or shares the role-section render verbatim (decide during build).
