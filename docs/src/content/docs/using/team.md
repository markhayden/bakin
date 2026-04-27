---
title: Team
description: "Org-chart view of your agent roster. Identity, skills, knowledge, heartbeats, and package state in one place."
---

Team is your agent roster. Who's on the team, who reports to whom, what each agent knows and can do, who's on shift right now. The plugin is an adapter over OpenClaw — every agent's identity, skills, and tools live in OpenClaw's home directory. Team owns only UI extras: avatars, display settings, heartbeats.

## The team view

<figure class="screenshot-frame">
  <figcaption>The team org chart with agent cards arranged in a node graph showing reporting and team structure.</figcaption>
</figure>

Visual org chart, not a flat list. Each agent is a card-shaped node; edges show reporting and team structure. Hover for status, click into the detail view for full identity.

## The agent detail view

<figure class="screenshot-frame">
  <figcaption>Agent detail view with tabs for Overview, Active Context, identity files, Heartbeat, and Knowledge.</figcaption>
</figure>

Tabs across the top:

- **Overview** — name, role, model, current status, recent activity.
- **Active Context** — what the agent is currently working on.
- **SOUL / IDENTITY / AGENTS / TOOLS** — the markdown files that define the agent. Edit in place.
- **Heartbeat** — live status snapshots.
- **Knowledge** — toggle individual lessons in the agent's knowledge pack on or off.

## Common actions

### Hire a new agent

`+ New Agent` walks you through name, role, model, and identity templates. Bakin installs the agent into OpenClaw with the right files in the right places.

### Adopt or install agent packages

Agents can come from agent packs (see [Essentials → Bundles](/docs/using/essentials/#bundles)). Adopt brings an existing OpenClaw agent under Bakin's management. Install drops in a fresh agent kit.

### Edit identity, soul, tools

The detail view's markdown tabs open the agent's actual files for editing. Save writes back to OpenClaw. Avatars upload separately and live in `~/.bakin/agents/<id>/`.

### Toggle knowledge lessons

Each agent kit ships a knowledge pack — markdown lessons the agent can pull from. Toggle individual lessons on or off without uninstalling the pack.

### Send a message

From the detail view, fire off a message to the agent directly. It lands in the agent's session and shows up in [Activity Feed](/docs/using/essentials/#activity-feed) once the agent picks it up.

## Concepts

- **OpenClaw owns the agent.** Identity, soul, AGENTS.md, TOOLS, skills — all of it lives under `~/.openclaw/agents/<id>/workspace/`. Team reads and writes those files but never copies them.
- **Three states per agent.**
  - `unmanaged` — agent exists in OpenClaw but Bakin doesn't track it
  - `adopted` — Bakin manages this agent without owning the kit
  - `managed` — Bakin installed the agent from a kit and owns the lifecycle
  - Plus `drifted` and `update-available` flags when the kit ships changes
- **Knowledge toggles persist in the lockfile.** Disabling a lesson doesn't delete it; it just flags it off in the agent-package lockfile. Re-enable anytime.

## Where state lives

```
~/.bakin/agents/<id>/                # UI extras only
  avatar.jpg
  avatar-full.png
  .installedBy
~/.bakin/heartbeats/*.json           # live status snapshots
~/.bakin/plugin-settings/team.json   # display preferences
~/.openclaw/agents/<id>/             # canonical agent state (Team reads this)
  workspace/
    SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md
    skills/
```

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 7 11 12 5 17"/><line x1="13" y1="17" x2="19" y2="17"/></svg>From the CLI

Team and packages share a CLI surface:

```sh
bakin agents list                                          # roster
bakin agents install <path|github:user/repo[@ref]>         # install an agent kit
bakin agents update <agent-id>                             # pull latest
bakin agents remove <agent-id>                             # uninstall
bakin agents knowledge <list|enable|disable> ...           # toggle lessons
bakin agents send <id> <message>                           # message an agent
bakin packages list                                        # all installed packs
```

Full surface in the [CLI reference](/docs/reference/generated/cli/).

<div class="for-agents">

## <svg class="heading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/><path d="M12 4v4"/><circle cx="12" cy="4" r="1" fill="currentColor"/></svg>For agents

Agents introspect and operate on the team through MCP exec tools.

<!-- docs:exec-tools team -->
- `bakin_exec_team_create_agent`: Create a new agent: registers in OpenClaw, writes persona files, configures dispatch permissions, optionally assigns to a team. Returns next-step instructions.
- `bakin_exec_team_delete_agent`: Remove an agent from OpenClaw and clean up Bakin state. Requires confirm=true as a safety guard.
- `bakin_exec_team_list`: List all agents with their current status (online/working/available/offline).
- `bakin_exec_team_members`: Get agents that belong to a specific team (e.g. "builders", "creators").
- `bakin_exec_team_message`: Send a message to an agent via OpenClaw.
- `bakin_exec_team_my_team`: Get the team that a specific agent belongs to, including all teammates.
- `bakin_exec_team_org`: Get the full org structure: teams with their members. Use this to understand who is on which team and reporting lines.
- `bakin_exec_team_profile`: Get the full profile for an agent including soul, rules, and tools.
- `bakin_exec_team_read_file`: Read a workspace file for an agent (e.g., SOUL.md, AGENTS.md, TOOLS.md).
- `bakin_exec_team_set_permissions`: Update dispatch permissions — which agents a given agent can dispatch tasks to (subagents.allowAgents).
- `bakin_exec_team_status`: Get the heartbeat and health status for an agent.
- `bakin_exec_team_update_identity`: Update an existing agent's identity fields (name, emoji, role, vibe, etc.) and/or workspace files (SOUL.md, TOOLS.md).
<!-- /docs:exec-tools -->

Full schemas in the [Exec tools reference](/docs/reference/generated/exec-tools/).

</div>

## Related

- [Models](/docs/using/models/): per-agent model configuration lives there
- [Memory](/docs/using/memory/): each agent's session and durable memory is searchable here
- [Essentials → Bundles](/docs/using/essentials/#bundles): how agent kits get installed in the first place
