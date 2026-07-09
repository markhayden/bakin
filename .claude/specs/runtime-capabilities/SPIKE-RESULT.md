# Phase 0 Spike Result — OpenClaw native MCP

Date: 2026-07-07 · Runtime: OpenClaw (box temporarily flipped, then restored to Pi) · **Verdict: PASS (unconditional)**

## Question (D21, broadened)
Does the adapter-provisioned **native-MCP** path work end-to-end on OpenClaw — agents reach Bakin tools via their MCP client (not `bash`+`mcporter`), full real task, **zero regressions** — so the plan can commit to deleting mcporter?

## Evidence

1. **Native connection already works.** `openclaw mcp probe` → OpenClaw natively connects to **every** bakin MCP server and exposes **125 tools each** (`bakin-main … bakin-zen`). The tools are already in each agent's native tool list; mcporter adds nothing.

2. **Agents call them natively when instructed.** Injected a native-MCP override banner into scout's `AGENTS.md` (told it the `bakin_exec_*` tools are available directly, ignore mcporter). Dispatched two real tasks:
   - Task A (create→log→complete): trajectory shows `tool.call` records `bakin-scout.bakin_exec_tasks_log_progress`, `bakin-scout.bakin_exec_tasks_complete` — clean JSON args, `isError:false`. Done in ~12s.
   - Task B (create→write file→save asset→complete): `bakin-scout.bakin_exec_tasks_log_progress` ×3, OpenClaw's own `apply_patch` (file write), `bakin-scout.bakin_exec_assets_save`, `bakin-scout.bakin_exec_tasks_complete`. **Asset actually created** (`20260707-text-80b21895`, `assets_save.ok by scout`). Done in ~54s.
   - **Zero `bash`, zero `mcporter` in either turn.** Four distinct Bakin tools exercised via native MCP; full asset flow; tasks completed normally.

## Facts that feed the build
- OpenClaw namespaces MCP tools as **`bakin-<agent>.<tool>`** (e.g. `bakin-scout.bakin_exec_tasks_log_progress`). The model resolves the namespace itself from its tool list given only a generic "your `bakin_exec_*` tools are available" instruction → the `mcp` renderer can be simple; `mcpServerTemplate: 'bakin-<agent>'` is the only fact it needs.
- The MCP config wiring (`config.mcp.servers` in `openclaw.json`) that makes this work already exists in core (`syncOpenClawMcpConfig`) — relocating it into `adapter-openclaw` is a code-move, not a behavior change. The spike validates the behavior the relocation preserves.

## Consequence for the plan
- OpenClaw → `RuntimeToolAccess.style = 'mcp'` (unconditional).
- **mcporter deletion is unblocked** — no runtime needs it (Pi in-process, OpenClaw native MCP).
- `cli-shim` retained only as the inert extension point.
