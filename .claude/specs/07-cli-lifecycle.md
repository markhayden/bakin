# Phase 7: CLI Lifecycle & File Sync

**Status:** Pending
**Dependencies:** Phases 0, 1, 4

## Purpose

Define the CLI commands that manage Bakin's lifecycle and keep managed files in sync with user/OpenClaw content. The core challenge: Bakin injects content into files that users and OpenClaw also edit. Block-based injection ensures safe coexistence.

## The File Sync Problem

Bakin needs to maintain content in files it doesn't fully own:
- Agent workspace files (AGENTS.md, SOUL.md) — OpenClaw creates these, user customizes them, Bakin injects tool/context blocks
- MCP configuration — Bakin registers its tools, user may add others
- Skill definitions — Bakin installs plugin skills, user may write custom ones

**Naive overwrite** destroys user customizations. **Naive append** creates duplicates. We need **block-based injection**.

## Block-Based Injection System

### Block Format

```markdown
<!-- BAKIN:START block-id -->
Content managed by Bakin. Do not edit manually — changes will be overwritten by `bakin sync`.
## Tools
- bakin_log_progress
- bakin_exec_save_asset
<!-- BAKIN:END block-id -->
```

### Rules

1. Bakin **only writes inside** `BAKIN:START/END` blocks
2. Content **outside blocks is never modified** by Bakin
3. Blocks are identified by ID (e.g., `agent-tools`, `agent-context`, `mcp-config`)
4. If a block **doesn't exist**, it's inserted at a designated injection point (typically top of file, after any frontmatter)
5. If a block **exists**, its inner content is replaced
6. **Deletion** of a block removes the tags and content, preserves everything else
7. Each block contains a "do not edit" comment so users understand the boundary

### Block Registry

Each plugin/module declares what blocks it manages:

```typescript
interface ManagedBlock {
  id: string                    // 'agent-tools', 'mcp-bakin-server'
  targetFile: string            // path pattern (e.g., '~/.openclaw/workspaces/{agent}/AGENTS.md')
  generateContent: (ctx: BlockContext) => string  // produces block inner content
  insertionPoint?: 'top' | 'bottom' | 'after-frontmatter'
}
```

The sync engine collects all managed blocks, resolves target files, and applies them.

### Implementation

```typescript
// packages/core/src/sync/block-engine.ts

function syncBlock(filePath: string, blockId: string, newContent: string): SyncResult {
  const existing = readFile(filePath)
  const startTag = `<!-- BAKIN:START ${blockId} -->`
  const endTag = `<!-- BAKIN:END ${blockId} -->`

  if (existing.includes(startTag)) {
    // Replace existing block content
    const updated = replaceBlockContent(existing, startTag, endTag, newContent)
    writeFile(filePath, updated)
    return { action: 'updated', blockId, file: filePath }
  } else {
    // Insert new block at injection point
    const updated = insertBlock(existing, startTag, endTag, newContent, 'after-frontmatter')
    writeFile(filePath, updated)
    return { action: 'created', blockId, file: filePath }
  }
}

function removeBlock(filePath: string, blockId: string): SyncResult {
  const existing = readFile(filePath)
  const updated = stripBlock(existing, blockId)
  writeFile(filePath, updated)
  return { action: 'removed', blockId, file: filePath }
}
```

## CLI Commands

### `bakin init`

First-time setup (detailed in Phase 6 spec):
- Create `~/.bakin/` directory structure
- Detect OpenClaw config, auto-detect main agent
- Generate managed files with injection blocks
- Set `setupComplete: true`

### `bakin start`

```
$ bakin start
Syncing managed files...
  ✓ 5 agent workspaces updated (3 blocks each)
  ✓ MCP config injected for 5 agents
Starting Bakin server on port 3737...
  ✓ 9 plugins loaded
  ✓ 18 exec tools registered
  ✓ SSE ready
  ✓ File watcher active
```

Flow:
1. Run `bakin sync` (non-interactive)
2. Start the Node.js server (`npx tsx server.ts`)
3. Wait for server ready signal

### `bakin restart`

```
$ bakin restart
Stopping Bakin server...
  ✓ Graceful shutdown (onShutdown hooks called)
Syncing managed files...
  ✓ Updated 2 blocks (new tools from plugin update)
Starting Bakin server...
  ✓ Ready on port 3737
```

Flow: stop → sync → start. Used after plugin install/update, agent config changes, or settings changes.

### `bakin sync`

Non-destructive resync of all managed files:

```
$ bakin sync
Scanning managed blocks...

Agent workspaces:
  ~/.openclaw/workspaces/roscoe/AGENTS.md
    [updated] agent-tools — 2 tools added
    [unchanged] agent-context
  ~/.openclaw/workspaces/pixel/AGENTS.md
    [unchanged] agent-tools
    [unchanged] agent-context
  ... (all agents)

MCP configuration:
  ~/.openclaw/workspaces/roscoe/mcp.json
    [updated] bakin-server — new exec tools registered
  ... (all agents)

Summary: 2 blocks updated, 28 unchanged, 0 created, 0 errors
```

**Flags:**
- `bakin sync` — standard sync, report changes
- `bakin sync --dry-run` — show what would change without writing
- `bakin sync --force` — recreate all blocks (useful after corruption)
- `bakin sync --verbose` — show block content diffs

### `bakin doctor`

Health check with expanded scope:

```
$ bakin doctor
Running diagnostics...

Dependencies:
  [OK] Node.js v22.5.0
  [OK] pnpm 10.2.0
  [OK] OpenClaw v1.4.0
  [WARN] Antfly — not found (search disabled)

Managed Files:
  [OK] 30 blocks across 10 files — all intact
  [WARN] ~/.openclaw/workspaces/basil/AGENTS.md — block 'agent-tools' modified manually
  [OK] MCP configs — all current

Plugins:
  [OK] 9 plugins loaded, 0 errors
  [OK] 18 exec tools registered, 0 collisions
  [OK] All plugin versions match manifests

Content Directory:
  [OK] ~/.bakin/ exists with correct structure
  [OK] TASKBOARD.md readable (23 tasks)
  [WARN] 2 orphaned heartbeat files (agents no longer in roster)

Settings:
  [OK] settings.json valid
  [OK] 4 plugin settings files valid

Agent Bridge:
  [OK] OpenClaw gateway responding on port 18789
  [OK] 5 agents reachable

Summary: 14 OK, 2 WARN, 0 ERROR
```

**Checks:**
1. **Dependencies** — Node.js version, pnpm, OpenClaw binary, Antfly (optional)
2. **Managed files** — all blocks intact, no corruption, no manual modifications inside blocks
3. **Plugins** — all loaded, versions match, no tool name collisions
4. **Content directory** — structure valid, key files readable, no orphaned data
5. **Settings** — valid JSON, schema conformance, no unknown keys
6. **Agent bridge** — gateway reachable, agents responsive
7. **Vault** — required secrets present for all plugins

### `bakin audit`

Deep audit comparing current state against expected state:

```
$ bakin audit
Deep audit of agent files, skills, and configuration...

Agent: roscoe
  AGENTS.md:
    [OK] Bakin context block present and current
    [OK] Tool list matches registered exec tools
    [WARN] User section references deprecated tool 'bakin_exec_old_tool'
  Skills:
    [OK] 5 Bakin-managed skills installed
    [FIX] 1 orphaned skill from uninstalled plugin 'analytics'

Agent: pixel
  AGENTS.md:
    [OK] Bakin context block present
    [FAIL] Tool list outdated — missing 3 new tools from assets plugin update
    [FIX] Run `bakin sync` to update

MCP Configuration:
  [OK] All 18 exec tools declared in agent MCP configs
  [WARN] Agent 'basil' has 2 unknown MCP servers (user-added, not managed)

Recommendations:
  1. Run `bakin sync` to fix 1 outdated tool list
  2. Remove orphaned skill: ~/.openclaw/workspaces/roscoe/skills/analytics-report.md
  3. Review deprecated tool reference in roscoe's user section

Run `bakin audit --fix` to apply safe fixes automatically.
```

**`--fix` flag:** Auto-applies safe fixes (update blocks, remove orphaned files). Prompts for destructive fixes (removing user content that references deprecated tools).

### `bakin upgrade`

Update plugin versions and run migrations:

```
$ bakin upgrade
Checking for plugin updates...
  tasks: 1.0.0 → 1.1.0 (1 migration)
  assets: 1.0.0 → 1.2.0 (2 migrations)

Running migrations...
  tasks/001-add-priority-field: ✓
  assets/001-normalize-sidecars: ✓
  assets/002-add-thumbnail-dir: ✓

Syncing managed files for new versions...
  ✓ Updated tool lists (3 new tools)
  ✓ Updated MCP configs

Upgrade complete. Run `bakin restart` to apply.
```

## Sync Triggers

| Trigger | Behavior |
|---------|----------|
| `bakin start` / `bakin restart` | Always sync before serving |
| `bakin install <plugin>` | Sync affected agent files after install |
| `bakin uninstall <plugin>` | Remove plugin's blocks from all managed files |
| Agent config change (via UI) | Sync that agent's workspace files |
| `bakin sync` (manual) | Full resync of all managed files |
| `bakin upgrade` | Sync after migrations complete |

## What Gets Synced

### Per-agent workspace files

**AGENTS.md blocks:**
- `agent-tools` — list of Bakin exec tools this agent can use
- `agent-context` — Bakin system context (what Bakin is, how to report progress, rules)
- `agent-workflows` — available workflow definitions

**MCP config:**
- Bakin's MCP server entry in the agent's `mcp.json`

### Skill files
- Plugin-provided skill definitions installed to `~/.openclaw/workspaces/{agent}/skills/`
- Each skill file is fully managed (not block-based — Bakin owns the entire file)
- Skill files managed by Bakin are prefixed: `bakin-{pluginId}-{skillName}.md`

## Key Files to Create

| File | Purpose |
|------|---------|
| `packages/core/src/sync/block-engine.ts` | Block read/write/insert/remove engine |
| `packages/core/src/sync/sync-manager.ts` | Orchestrates sync across all managed files |
| `packages/core/src/sync/block-registry.ts` | Collects managed block declarations from plugins |
| `packages/core/src/cli/init.ts` | `bakin init` implementation |
| `packages/core/src/cli/doctor.ts` | Expanded doctor (wraps existing + new checks) |
| `packages/core/src/cli/audit.ts` | Deep audit implementation |
| `packages/core/src/cli/sync.ts` | `bakin sync` CLI handler |

## Verification

- [ ] Edit content **outside** a Bakin block → `bakin sync` preserves it unchanged
- [ ] Edit content **inside** a Bakin block → `bakin sync` overwrites it with correct content
- [ ] Delete a Bakin block entirely → `bakin sync` re-creates it
- [ ] `bakin sync --dry-run` shows accurate preview without writing
- [ ] `bakin doctor` reports clean after `bakin sync`
- [ ] `bakin audit` correctly identifies outdated tool lists, orphaned skills, deprecated references
- [ ] `bakin audit --fix` applies safe fixes, prompts for unsafe ones
- [ ] Install a new plugin → `bakin sync` updates all agent tool lists
- [ ] Uninstall a plugin → `bakin sync` removes that plugin's blocks and skills
- [ ] Full round-trip: `rm -rf ~/.bakin && bakin init && bakin start && bakin doctor` — all green
