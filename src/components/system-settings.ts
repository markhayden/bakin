/**
 * "System & Alerts" — virtual settings tab for the core ~/.bakin/settings.json.
 *
 * The plugin settings UI is per-plugin and works on flat key/value JSON. Core
 * settings are nested (watchdog.intervalMs, notifications.channel, etc).
 * We expose them through the same renderer by flattening to dotted keys on
 * read and unflattening back to nested objects on save. The renderer never
 * needs to know.
 */
import type { PluginSettingsSchema } from '@bakin/core/plugin-types'

export const SYSTEM_SETTINGS_TAB_ID = '__system'

export const SYSTEM_SETTINGS_SCHEMA: PluginSettingsSchema = {
  fields: [
    // ── Kill switch (cost-control v2) ─────────────────────────────────
    {
      key: 'dispatch.paused',
      type: 'boolean',
      label: 'Pause all dispatch (kill switch)',
      description: 'Break-glass control: pauses ALL task dispatch and billed media calls until turned off. In-flight turns finish. Also: the header banner Resume button or `bakin budget pause|resume`.',
      default: false,
    },
    // ── Dispatch concurrency (#447) ───────────────────────────────────
    {
      key: 'dispatch.maxConcurrentTurns',
      type: 'number',
      label: 'Max concurrent dispatch turns (global)',
      description: 'Dispatch turns in flight across ALL agents. Both gates apply together: a turn fires only when it is under this AND the per-agent cap. Default 3.',
      default: 3,
    },
    {
      key: 'dispatch.maxTurnsPerAgent',
      type: 'number',
      label: 'Max dispatch turns per agent',
      description: 'Turns in flight for ONE agent. Honored only on runtimes that declare per-run isolation (see the Runtime page for what the active runtime supports); others clamp to 1 with an audit receipt regardless of this value — raising only the global cap adds no parallelism while work queues behind one agent. Default 2.',
      default: 2,
    },
    {
      key: 'dispatch.runDirRetentionDays',
      type: 'number',
      label: 'Run scratch retention (days)',
      description: 'Days a SUCCESSFUL run\'s scratch dir is kept under ~/.bakin/run-workspaces before the sweep removes it. Failed runs keep a fixed 30-day salvage window. Default 7.',
      default: 7,
    },
    {
      key: 'dispatch.runDirMaxTotalGb',
      type: 'number',
      label: 'Run workspaces disk budget (GB)',
      description: 'Hard ceiling on run-workspace scratch usage — the sweep evicts oldest settled dirs first when exceeded (never live turns; repo checkouts are governed by their own time windows). Retention days are ceilings, never floors that outrank the disk. 0 disables. Default 4.',
      default: 4,
    },
    // ── Alert delivery ────────────────────────────────────────────────
    {
      key: 'notifications.channel',
      type: 'string',
      label: 'Alert runtime channel',
      description: 'Runtime channel ID for watchdog alerts, MCP/REST outage alerts, and gate approval reminders. Leave blank for in-app alerts only.',
      default: '',
    },
    // Gate approval alerts are owned by the workflows plugin
    // (approvalChannelAlerts in its plugin settings), not by system settings.
    // ── Watchdog tunables ─────────────────────────────────────────────
    {
      key: 'watchdog.intervalMs',
      type: 'number',
      label: 'Watchdog interval (ms)',
      description: 'How often the watchdog scans for stuck tasks and unhealthy MCP. Default 300000 (5 min).',
      default: 300000,
    },
    {
      key: 'watchdog.stuckThresholdMs',
      type: 'number',
      label: 'Stuck task threshold (ms)',
      description: 'A task is considered stuck if its last log entry is older than this. Default 1800000 (30 min).',
      default: 1800000,
    },
    {
      key: 'watchdog.autoRecover',
      type: 'boolean',
      label: 'Auto-recover stuck tasks',
      description: 'When both task and agent are stale, move the task back to Todo for re-dispatch (up to the recovery limit below).',
      default: true,
    },
    {
      key: 'watchdog.maxAutoRecoveries',
      type: 'number',
      label: 'Max auto-recoveries per task',
      description: 'After this many recoveries, the task is escalated to Blocked instead of redispatched. Default 3.',
      default: 3,
    },

    // ── MCP 5xx alerting (issue #81 item 5) ───────────────────────────
    {
      key: 'watchdog.mcpWindowMs',
      type: 'number',
      label: 'MCP error window (ms)',
      description: 'Rolling window for the MCP 5xx error rate check. Default 60000 (60s).',
      default: 60000,
    },
    {
      key: 'watchdog.mcpErrorThreshold',
      type: 'number',
      label: 'MCP error rate threshold',
      description: 'Fraction of /mcp requests in the window that must be 5xx to fire an alert. 0.5 = 50%. Default 0.5.',
      default: 0.5,
    },
    {
      key: 'watchdog.mcpMinSamples',
      type: 'number',
      label: 'MCP minimum samples',
      description: 'Skip the rate check until at least this many MCP requests have been made in the window. Prevents false alarms on idle servers. Default 3.',
      default: 3,
    },
    {
      key: 'watchdog.mcpAlertCooldownMs',
      type: 'number',
      label: 'MCP alert cooldown (ms)',
      description: 'Suppress duplicate MCP alerts within this window. Default 300000 (5 min).',
      default: 300000,
    },
    // ── Health sensitivity (#690) ─────────────────────────────────────
    {
      key: 'doctor.sensitivity',
      type: 'select',
      label: 'Health sensitivity',
      description: 'How loudly Health findings surface. Developer shows raw severities everywhere; Standard (default) calms expected noise (housekeeping, guardrail denials, usage anomalies, unsupported surfaces) to advisory; Quiet additionally notifies only for action-required findings — watch items stay visible on the Health page but silent. Takes effect on the next doctor cycle, no restart.',
      options: [
        { value: 'developer', label: 'Developer — show everything at raw severity' },
        { value: 'standard', label: 'Standard — calm expected noise (default)' },
        { value: 'quiet', label: 'Quiet — notify only for action-required' },
      ],
      default: 'standard',
    },
    // ── Agent token burn (#385) ───────────────────────────────────────
    {
      key: 'burn.windowHours',
      type: 'number',
      label: 'Burn check window (hours)',
      description: 'Rolling window for the agent token-burn checks (effort-vs-outcome and unattributed usage). Default 24.',
      default: 24,
    },
    {
      key: 'burn.minTokensFloor',
      type: 'number',
      label: 'Burn floor (tokens)',
      description: 'An agent must burn at least this many Bakin-attributed tokens in the window before the "lots of effort, no completed tasks" flag can fire. Default 500000.',
      default: 500000,
    },
    {
      key: 'burn.spikeMultiplier',
      type: 'number',
      label: 'Spike multiplier',
      description: "Today's observed tokens must exceed the agent's own trailing daily average by this factor to be flagged as a spike. Default 3.",
      default: 3,
    },
    {
      key: 'burn.baselineDays',
      type: 'number',
      label: 'Spike baseline (days)',
      description: 'Trailing days (excluding today) that form the spike baseline. Default 7.',
      default: 7,
    },
    {
      key: 'burn.unattributedShare',
      type: 'number',
      label: 'Usage bucket share threshold',
      description: 'Fraction of an agent\'s observed tokens a bucket (interactive sessions, or unexplained usage) must reach before its flag fires. 0.5 = 50%. Default 0.5.',
      default: 0.5,
    },
    {
      key: 'burn.unattributedFloorTokens',
      type: 'number',
      label: 'Usage bucket floor (tokens)',
      description: 'Minimum tokens in a bucket (interactive sessions, or unexplained usage) before its flag fires. Default 100000.',
      default: 100000,
    },
    {
      key: 'burn.runawayAssistantTurns',
      type: 'number',
      label: 'Runaway turn threshold',
      description: 'Token-bearing assistant turns an external session must accumulate — with zero user turns — before the runaway signal fires. Default 20.',
      default: 20,
    },
    {
      key: 'burn.runawayFloorTokens',
      type: 'number',
      label: 'Runaway floor (tokens)',
      description: 'Minimum tokens a zero-user-turn external session must accumulate before the runaway signal fires. Default 1000000.',
      default: 1000000,
    },
    // ── Startup context (#357) ────────────────────────────────────────
    {
      key: 'dispatch.maxWorkflowContextBytes',
      type: 'number',
      label: 'Workflow context budget (bytes)',
      description: 'Byte budget for prior-step outputs injected into workflow dispatch prompts. Newest outputs are kept whole; older ones are omitted with a visible marker (agents fetch full history on demand). Default 16384; minimum 1024.',
      default: 16384,
    },
    {
      key: 'dispatch.maxBrandContextBytes',
      type: 'number',
      label: 'Brand context budget (bytes)',
      description: 'Byte budget for the brand card injected into branded dispatch prompts. Card sections are kept whole in priority order (rules and palette always survive); anything dropped leaves a visible marker pointing at the brand exec tools. Default 12288; minimum 1024.',
      default: 12288,
    },
    {
      key: 'dispatch.contextBudgetBytes',
      type: 'number',
      label: 'Startup context warn budget (bytes)',
      description: 'Doctor warn threshold for estimated Bakin-injected per-dispatch context per agent (static prompt sections + configured caps). Warn-only — dispatch is never blocked. Default 65536.',
      default: 65536,
    },
  ],
}

/** Pluck a dotted-path value from a nested object. */
function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, obj)
}

/** Set a dotted-path value on a nested object, creating sub-objects as needed. */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

/**
 * Flatten the relevant slice of a BakinSettings object into the dotted-key
 * shape the renderer expects. Only fields declared in SYSTEM_SETTINGS_SCHEMA
 * are pulled — every other key in settings.json is left untouched.
 */
export function flattenSystemSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const field of SYSTEM_SETTINGS_SCHEMA.fields) {
    const v = getPath(settings, field.key)
    flat[field.key] = v ?? field.default
  }
  return flat
}

/**
 * Build the partial nested object the /api/settings POST endpoint expects.
 * Only the fields declared in the schema are written; deepMerge on the
 * server side preserves everything else in settings.json.
 */
export function unflattenSystemSettings(flat: Record<string, unknown>): Record<string, unknown> {
  const nested: Record<string, unknown> = {}
  for (const field of SYSTEM_SETTINGS_SCHEMA.fields) {
    if (!(field.key in flat)) continue
    setPath(nested, field.key, flat[field.key])
  }
  return nested
}
