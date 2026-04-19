# SPEC: Agent Lifecycle MCP Tools

_Created: 2026-04-15 | Owner: Mark_

## Objective

Replace the team plugin's direct `openclaw.json` writers (`addAgent`, `removeAgent`) with an OpenClaw CLI adapter layer, and expose a granular family of MCP exec tools so agents can create, update, and manage other agents without fumbling. The UI create/delete flows continue to route through REST endpoints, which call the same CLI adapter underneath.

This also establishes the hook for future soul-writing coaching — the structured IDENTITY fields give us a validation surface, and the raw SOUL/TOOLS markdown gives us a place to inject best-practice guidance later.

### Who this is for
- **Primary:** Roscoe (main orchestrator agent) — needs a discoverable tool to stand up new agents end-to-end.
- **Secondary:** Any subagent with dispatch permissions — needs to create tasks for new agents.
- **Tertiary:** Mark (human) — the team-page UI should use the same underlying code path.

### Success criteria
1. `openclaw agents add` / `delete` / `set-identity` are the only write paths for agent lifecycle. No direct `openclaw.json` writes remain for add/delete.
2. Agents can create a fully functional new agent via a single MCP tool call (`bakin_exec_team_create_agent`).
3. The existing UI create/delete flows work identically but use the CLI adapter underneath.
4. Jessica Fetcher is cleaned up and registered as dogfood validation.

---

## MCP Exec Tools (4 new tools)

### 1. `bakin_exec_team_create_agent`

Creates a new agent: registers in OpenClaw, writes persona files, configures dispatch permissions, optionally assigns to a team.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | no | Agent ID. Lowercase alphanumeric + hyphens. Auto-derived from `name` if omitted. |
| `name` | string | yes | Display name (e.g. "Jessica Fetcher") |
| `emoji` | string | no | Single emoji (e.g. "🔎") |
| `role` | string | no | One-line role description (e.g. "Research Agent") |
| `vibe` | string | no | Personality vibe (e.g. "Sharp, credible, practical, curious") |
| `primaryFunction` | string | no | What the agent does (e.g. "Multi-source research, evidence gathering") |
| `defaultMode` | string | no | How the agent operates by default |
| `model` | string | no | Full provider/model string. Defaults to `agents.defaults.model.primary`. |
| `soul` | string | no | Raw markdown for SOUL.md. Free-form persona definition. |
| `tools` | string | no | Raw markdown for TOOLS.md. Tool usage guidance. |
| `teamId` | string | no | Bakin team to assign the agent to (e.g. "builders") |
| `dispatchable` | `"all"` \| `"main"` \| `string[]` | no | Who can dispatch tasks to this agent. Default: `"main"`. `"all"` adds to every agent's `allowAgents` that already has a list. |

**Behavior:**
1. Validate `id` format (lowercase alphanum + hyphens, not "main", not duplicate).
2. Shell out to `openclaw agents add {name} --workspace ~/.openclaw/workspaces/{id} --model {model} --non-interactive --json`.
3. Shell out to `openclaw agents set-identity --agent {id} --name "{name}" --emoji {emoji}`.
4. Synthesize and write `IDENTITY.md` from structured fields.
5. Write `SOUL.md` if `soul` provided.
6. Write `TOOLS.md` if `tools` provided.
7. Update `subagents.allowAgents` on `main` (and optionally other agents) based on `dispatchable`.
8. Assign to Bakin team if `teamId` provided (write to `team.json` display settings).
9. Audit event: `agent.created`.
10. Search index the new agent.
11. Sync mcporter, restart gateway.
12. Return `{ ok: true, id, workspace, gatewayRestarted, instructions }`.

The `instructions` field in the response provides next-step guidance to the calling agent (e.g. "Agent created. You can now assign tasks to jessica-fetcher via bakin_exec_tasks_create. Consider writing a detailed SOUL.md to define their personality.").

**IDENTITY.md synthesis template:**
```markdown
# IDENTITY.md

- **Name:** {name}
- **Role:** {role}
- **Emoji:** {emoji}
- **Vibe:** {vibe}
- **Primary Function:** {primaryFunction}
- **Default Mode:** {defaultMode}
```

Only non-empty fields are included.

### 2. `bakin_exec_team_update_identity`

Updates an existing agent's identity fields and/or workspace files.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `agentId` | string | yes | Target agent ID |
| `name` | string | no | New display name |
| `emoji` | string | no | New emoji |
| `role` | string | no | Updated role |
| `vibe` | string | no | Updated vibe |
| `primaryFunction` | string | no | Updated primary function |
| `defaultMode` | string | no | Updated default mode |
| `soul` | string | no | Replace SOUL.md content |
| `tools` | string | no | Replace TOOLS.md content |

**Behavior:**
1. Validate agent exists in the roster.
2. If `name` or `emoji` changed: shell out to `openclaw agents set-identity --agent {id} --name "{name}" --emoji {emoji}`.
3. Re-synthesize and overwrite `IDENTITY.md` merging new fields with existing fields (read current IDENTITY.md, overlay provided fields).
4. Overwrite `SOUL.md` / `TOOLS.md` if provided.
5. Bust openclaw config cache.
6. Audit event: `agent.identity_updated`.
7. Return `{ ok: true, id, updated: [...fieldNames] }`.

### 3. `bakin_exec_team_delete_agent`

Removes an agent from OpenClaw and cleans up Bakin state.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `agentId` | string | yes | Agent to delete |
| `confirm` | boolean | yes | Must be `true` — safety guard against accidental deletion |

**Behavior:**
1. Reject if `agentId === "main"`.
2. Reject if `confirm !== true`.
3. Shell out to `openclaw agents delete {id} --force --json`.
4. Clean up Bakin display settings, search index, heartbeat file.
5. Remove agent from ALL agents' `subagents.allowAgents` lists in `openclaw.json`.
6. Audit event: `agent.deleted`.
7. Sync mcporter, restart gateway.
8. Return `{ ok: true, id, trashed: true }`.

### 4. `bakin_exec_team_set_permissions`

Updates dispatch permissions (which agents a given agent can dispatch to).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `agentId` | string | yes | Agent whose `allowAgents` to modify |
| `allowAgents` | string[] | yes | Full replacement list of agent IDs this agent can dispatch to |

**Behavior:**
1. Validate `agentId` exists.
2. Validate all target IDs exist in the roster.
3. Prevent self-referencing (agent can't dispatch to itself).
4. Write updated `subagents.allowAgents` to `openclaw.json`. No CLI command exists for this — isolated direct write via `setSubagentPermissions()`.
5. Bust config cache.
6. Audit event: `agent.permissions_updated`.
7. Return `{ ok: true, agentId, allowAgents }`.

---

## Adapter Layer Changes (`plugins/team/lib/openclaw-adapter.ts`)

### Replace: `addAgent()` (lines 302-349)

Delete the current implementation that writes `openclaw.json` directly. Replace with:

```typescript
export async function addAgent(input: CreateAgentInput): Promise<{ id: string; workspace: string }>
```

- Shells out to `openclaw agents add` + `openclaw agents set-identity`.
- Writes IDENTITY.md / SOUL.md / TOOLS.md to the new workspace.
- Returns the created workspace path.
- **Breaking change:** function becomes async (was sync). All callers must await.

### Replace: `removeAgent()` (lines 356-383)

Delete the current implementation. Replace with:

```typescript
export async function removeAgent(agentId: string): Promise<boolean>
```

- Shells out to `openclaw agents delete --force --json`.
- Returns true if successful, false if agent not found.
- OpenClaw CLI handles workspace-to-trash move natively.
- **Breaking change:** function becomes async. All callers must await.

### New: `updateAgentIdentity()`

```typescript
export async function updateAgentIdentity(agentId: string, fields: IdentityFields): Promise<string[]>
```

- Shells out to `openclaw agents set-identity` for name/emoji changes.
- Re-synthesizes IDENTITY.md from merged fields.
- Returns list of updated field names.

### New: `setSubagentPermissions()`

```typescript
export function setSubagentPermissions(agentId: string, allowAgents: string[]): void
```

- Direct `openclaw.json` write — no CLI command exists for this operation.
- Isolated to this single function so when OpenClaw adds a CLI command later, we replace one function.

### New: `addToAllowLists()`

```typescript
export function addToAllowLists(newAgentId: string, dispatchable: 'all' | 'main' | string[]): void
```

- Handles the `dispatchable` param from create. Modifies `subagents.allowAgents` on the relevant agents.

### New: `removeFromAllowLists()`

```typescript
export function removeFromAllowLists(agentId: string): void
```

- Cleanup on delete. Removes the agent from all `subagents.allowAgents` across the roster.

### CLI helper (shared)

```typescript
async function openclawExec(args: string[]): Promise<string>
```

- Uses `settings.openclaw.binaryPath` + `execFileAsync` (same pattern as `restartGateway()` in `src/core/openclaw-client.ts`).
- Returns stdout. Throws on non-zero exit with stderr in error message.

### Delete: `NewAgentInput` interface

Replace with `CreateAgentInput` that has the full field set.

---

## REST Route Changes (`plugins/team/index.ts`)

### Modify: `POST /` (create agent, line 439)
- Await the now-async `adapter.addAgent()`.
- Accept additional body fields: `role`, `vibe`, `primaryFunction`, `defaultMode`, `tools`, `teamId`, `dispatchable`.
- After creation, handle team assignment and dispatch permissions.
- Existing fields (`id`, `name`, `emoji`, `model`, `soul`) unchanged.

### Modify: `DELETE /:agentId` (delete agent, line 489)
- Await the now-async `adapter.removeAgent()`.
- Add `removeFromAllowLists(agentId)` call for dispatch permission cleanup.

### New: `PUT /:agentId/identity`
- Accepts identity fields + soul/tools markdown.
- Calls `adapter.updateAgentIdentity()`.
- Writes soul/tools if provided.
- Audits, busts cache.

### New: `PUT /:agentId/permissions`
- Accepts `{ allowAgents: string[] }`.
- Calls `adapter.setSubagentPermissions()`.
- Audits, busts cache.

---

## UI Changes (`plugins/team/components/agent-form.tsx`)

Add optional fields to the creation form, collapsible under an "Advanced" section:
- **Role** — text input
- **Vibe** — text input
- **Primary Function** — text input
- **Tools** — textarea (raw markdown, same style as SOUL.md textarea)
- **Team** — dropdown (fetches from `/api/plugins/team/teams`)

The form continues to POST to `/api/plugins/team/` (REST route, not MCP).

No changes to existing fields (name, id, emoji, model, soul, avatar).

---

## Subagent Dispatch Permissions

### Current state
- `main.subagents.allowAgents`: `["pixel", "patch", "basil", "rolo", "scout", "nemo", "zen"]`
- `basil.subagents.allowAgents`: `["pixel", "rolo"]`
- All other agents: no `allowAgents` (can't dispatch)

### On create
- `dispatchable: "main"` (default) — add new agent to `main.subagents.allowAgents` only.
- `dispatchable: "all"` — add new agent to every agent's `allowAgents` that already has a non-empty list. For agents without an existing list, create `allowAgents: [newId]`.
- `dispatchable: ["basil", "scout"]` — add to those specific agents' lists, plus always `main`.

### On delete
- Remove deleted agent from ALL agents' `allowAgents` lists.

---

## Jessica Fetcher Cleanup (dogfood)

After the tools are built, use the REST endpoint (or MCP tool) to:
1. Create `jessica-fetcher` using content from the 6 draft files in `~/.openclaw/workspace/`.
2. Delete the 6 stray `~/.openclaw/workspace/jessica-fetcher-*.md` files.
3. Assign to appropriate team.
4. Set `dispatchable: "all"` (any agent can task her with research).

---

## Testing Strategy

### Unit tests (vitest)

**`tests/plugins/team/openclaw-adapter.test.ts`** — add tests for:
- `addAgent` — mock `execFileAsync`, verify CLI args, verify IDENTITY.md/SOUL.md written to temp workspace
- `removeAgent` — mock `execFileAsync`, verify CLI args
- `updateAgentIdentity` — verify CLI args + IDENTITY.md merge
- `setSubagentPermissions` — verify openclaw.json write
- `addToAllowLists` / `removeFromAllowLists` — verify correct agents updated

**`tests/plugins/team/routes.test.ts`** — add tests for:
- `POST /` with new fields (role, vibe, teamId, dispatchable)
- `DELETE /:agentId` with allowlist cleanup
- `PUT /:agentId/identity`
- `PUT /:agentId/permissions`

**`tests/plugins/team/exec-tools.test.ts`** (new file) — test all 4 MCP tools via `callTool` helper from `test-helpers.ts`.

### Mandatory test mocks (per CLAUDE.md)
- `getContentDir` → temp dir
- `getOpenClawHome` / `getOpenClawPath` → temp dir
- `createLogger` → noop
- `watcher` → noop
- `child_process.execFile` → mock (captures CLI args, returns mock JSON)
- `openclaw-client` → mock (prevents real gateway restarts)

---

## Knowledge / Docs Updates

### Update: `.claude/knowledge/team-plugin.md`
- Document the new CLI adapter pattern (addAgent/removeAgent shell out)
- Document the 4 new exec tools
- Document the new REST routes (PUT identity, PUT permissions)
- Update the "Common Pitfalls" section

### Update: `.claude/knowledge/agent-system.md`
- Update the MCP tool count (8 → 12 for team plugin, 75 → 79 total)
- Document the dispatch permission management pattern

---

## Boundaries

### Always do
- Shell out to `openclaw agents *` CLI for add/delete/identity operations
- Bust `openclaw-config.ts` cache after any roster write
- Audit every lifecycle event
- Clean up dispatch permissions on agent deletion
- Validate agent IDs at the boundary

### Ask first
- Changes to existing agent form field behavior (beyond adding new ones)
- Model configuration changes (that's the models plugin's domain)
- Changes to build-graph.ts or the team pyramid layout

### Never do
- Write to `openclaw.json` directly for agent add/delete (the whole point of this spec)
- Add `BakinSettings.agents` or any agent roster cache outside `openclaw-config.ts`
- Break the existing 8 MCP exec tools or 25 REST routes
- Touch the main agent's identity or permissions without explicit confirmation
- Skip gateway restart after roster changes

---

## Commit Strategy

| # | Scope | Rollback safe? |
|---|-------|----------------|
| 1 | **Adapter: CLI helper + async addAgent** — add `openclawExec()`, replace `addAgent()` with async CLI version. Update POST route caller. Tests. | Yes |
| 2 | **Adapter: async removeAgent** — replace with CLI version. Update DELETE route caller. Tests. | Yes |
| 3 | **Adapter: updateIdentity + permissions helpers** — new functions + tests. Additive only. | Yes |
| 4 | **REST routes: PUT identity + PUT permissions** — new endpoints + tests. Additive. | Yes |
| 5 | **MCP tools: all 4 exec tools** — register in index.ts + tests. Additive. | Yes |
| 6 | **UI: agent-form advanced fields** — add role, vibe, tools, team to form. | Yes |
| 7 | **Cleanup: dead code removal** — old `NewAgentInput`, unused sync imports. | Yes |
| 8 | **Docs: update knowledge files** — team-plugin.md, agent-system.md. | Yes |
| 9 | **Dogfood: register Jessica Fetcher** — runtime data change only. | Yes |

---

## Out of Scope

- Channel bindings (`openclaw agents bind/unbind`) — future feature
- Avatar upload via MCP tool — existing avatar POST route is sufficient
- Soul-writing coaching/validation — future enhancement (structured IDENTITY gives us the hook)
- Sandbox/container configuration for new agents
- Agent start/stop lifecycle changes
