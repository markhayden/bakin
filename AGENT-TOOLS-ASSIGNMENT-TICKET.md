# Agent Tools Assignment Ticket

## Problem

Bakin currently does not have a real per-agent tool assignment model.

- MCP/exec tools are registered globally by the server.
- Agents appear to receive the shared tool registry at session init.
- The removed "Tool Models" column in the Models plugin was hardcoded UI, not real config.
- Agent-specific guidance currently lives mostly in workspace files such as `TOOLS.md`.

## Questions To Resolve

1. Are tools truly globally callable by every connected agent, or are there existing runtime restrictions we are not surfacing?
2. What is the intended source of truth for agent tool access:
   `openclaw.json`, workspace files, plugin permissions, or a new Bakin-owned layer?
3. How should delegation permissions such as `subagents.allowAgents` relate to tool permissions, if at all?
4. Should `TOOLS.md` remain descriptive only, or become a generated/validated reflection of actual allowed tools?
5. Do we need separate concepts for:
   agent can call tool,
   agent is instructed to use tool,
   agent prefers provider/model for a tool-backed workflow?

## Proposed Follow-up

1. Audit the MCP registration and session binding path.
2. Document the current effective tool-access model.
3. Decide whether per-agent tool assignment belongs in OpenClaw, Bakin, or both.
4. If needed, design:
   a persisted schema,
   enforcement point,
   UI surface in Team or Models,
   migration path from `TOOLS.md` notes.

## Notes

Relevant files:

- `src/core/mcp-server.ts`
- `scripts/lib/registry.ts`
- `plugins/team/lib/openclaw-adapter.ts`
- `plugins/team/components/agent-detail.tsx`
- `plugins/models/components/models-page.tsx`
