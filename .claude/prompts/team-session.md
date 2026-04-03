# Team Plugin Session

## Context

We just finished a massive plugin audit + MCP migration across all 9 Bakin plugins (branch: `refactor`). Everything is RESTful, exec tools are in plugins, docs are synced, 969/969 tests pass. Now we're turning to the **Team** page — the agent management UI.

## Current State

Team is NOT a plugin yet. It lives in:
- **Page:** `src/app/team/page.tsx`
- **Components:** `src/components/team/` (agent-drawer.tsx, agent-edit-form.tsx, team-grid.tsx)
- **Data:** `src/lib/agents-data.ts` (agent profiles, single source of truth)
- **Settings:** `src/lib/agent-settings.ts`
- **API routes:** `src/app/api/agents/` (avatar, health, status)
- **Avatars:** `~/.bakin/agents/{id}/avatar.jpg`, served via `/api/agents/avatar?id=X`
- **Heartbeats:** `~/.bakin/heartbeats/` (JSON files per agent)

## What Needs to Happen

### 1. Decide: Plugin or Keep in Core?
Team/agents are foundational — every other plugin references agents. Does it make sense as a plugin, or should it stay in core with the components moved to a cleaner location?

### 2. Agent Management Features
- View all agents with status (online/offline via heartbeats)
- Edit agent identity (name, emoji, description, capabilities)
- Agent avatar management (view, upload, generate)
- Per-agent model configuration
- Agent activity history (recent tasks, audit events)
- Agent skill/tool restrictions

### 3. Related Specs
- `.claude/specs/agent-avatars.md` — avatar pipeline, storage, API
- `.claude/specs/03-design-system.md` — standardized AgentAvatar component
- `.claude/specs/05-audit-health.md` — health plugin needs exec tools for agent status
- `.claude/specs/05-audit-models.md` — model config per agent

### 4. Known Issues
- Agent data is split between `agents-data.ts` (hardcoded profiles) and `~/.bakin/agents/` (runtime data)
- No standardized `AgentAvatar` component — each usage is ad-hoc
- Health plugin has no exec tools for agents to query system/agent status
- Models plugin has no exec tools for agents to query available models

## Additional Notes

1. Team needs to be CORE plugin
2. we should update the UX/UI based on all the other changes we've made. Tighten it up.
3. We need the ability to see and edit all of the soul, agents, etc files that are related directly to each agent.
4. We need an interface for manaing the agents details, name, nickname, bio, headshot/avatar, etc.,
5. Eventaully we'll have a marketplace where you can recruit more team members
6. Eventaually we'll have a marketplace where you can "train" your team member, which will just inject instructiosn and info ito their source files or instruct them about particular skills
7. let me know what els would be useful in understanding and managing a team of bad ass ai agents that can scale and evovle?
