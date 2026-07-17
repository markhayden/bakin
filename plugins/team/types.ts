/** Lightweight agent info for badges, dropdowns, selectors */
export interface AgentMeta {
  id: string
  name: string
  emoji: string
  role: string
  headshot: string
}

/** Full agent profile merged from runtime config + workspace files */
export interface AgentProfile extends AgentMeta {
  model: string
  workspacePath: string
  soul: string | null
  identity: string | null
  rules: string | null
  tools: string | null
  heartbeatMd: string | null
  subagentPerms: string[] | null
}

/** Agent with runtime status */
export interface AgentWithStatus extends AgentMeta {
  status: 'online' | 'working' | 'available' | 'offline'
  model: string
  heartbeat: HeartbeatData | null
  heartbeatAge: number | null
}

export interface HeartbeatData {
  timestamp: string
  status: string
  currentTask?: string
}

/** Display-only settings owned by Bakin */
export interface AgentDisplaySettings {
  displayName?: string
  accentColor?: string
  teamId?: string
}

export type AgentDisplaySettingsMap = Record<string, AgentDisplaySettings>

/** Organizational team — Bakin-owned grouping layer */
export interface OrgTeam {
  id: string
  label: string
  /**
   * Agent ID this team reports to, or `null` to indicate "reports to the
   * main orchestrator". Stored as `null` whenever the incoming value
   * matches the current main agent id so team.json stays decoupled from
   * the specific orchestrator name.
   */
  reportsTo: string | null
  color?: string
  order?: number
}

/** Full team settings stored in team.json */
export interface TeamPluginSettings {
  displaySettings: AgentDisplaySettingsMap
  teams: OrgTeam[]
}

/** Skill summary from workspace skills/ directory */
export interface SkillSummary {
  id: string
  name: string
  hasSkillMd: boolean
}

/**
 * Per-agent agent-package state, sourced from `/api/agent-packages`. Mirrors
 * the server-side `AgentStateInfo` shape but stays self-contained so the
 * client doesn't reach across the package boundary for types.
 *
 * The server today returns 3 states (`absent | unmanaged | managed`).
 * `drifted` and `update-available` are display states layered on top of the
 * server row when diagnostics or update checks report additional status.
 */
export interface PackageStateRow {
  agentId: string
  state: 'absent' | 'unmanaged' | 'managed' | 'drifted' | 'update-available'
  version?: string
  packageId?: string
  entry?: {
    source: string
    ref: string
    commitSha: string
    installedAt: string
    version?: string
    dependencies?: string[]
  }
  updateStatus?: {
    currentVersion: string
    latestVersion: string | null
    currentCommitSha: string
    latestCommitSha: string | null
    upgradeAvailable: boolean
    checkedAt: string
    error?: string
  }
}

/**
 * Single message from a runtime session JSONL. Used by the Active Context
 * tab to render what the agent has actually been sent + has produced.
 */
export interface SessionMessage {
  /** system / user / assistant / tool — drives the role badge color */
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** Raw text content. JSON tool calls are pretty-printed by the renderer. */
  content: string
  /** Model id present on assistant messages when usage was recorded. */
  model?: string
  /** ISO timestamp when present; absent on synthetic system messages. */
  ts?: string
  /** Tool name for `role: 'tool'` entries. */
  toolName?: string
}

/**
 * Latest-session transcript surfaced through `/api/plugins/team/:id/active-context`.
 * `truncated` is true when the underlying JSONL had more than the requested
 * cap (default 200) and we returned the most-recent N.
 */
export interface SessionTranscript {
  sessionId: string
  sessionStarted: string | null
  messages: SessionMessage[]
  truncated: boolean
  totalMessages: number
}

/**
 * Per-agent activity counts pulled from the in-memory `recordUsage` recorder.
 * Resets on server restart — `sinceServerStart` exists so the UI can frame
 * the numbers honestly rather than claim lifetime totals.
 */
export interface RecentActivity {
  windowMs: Record<'5m' | '1h' | '24h', number>
  errors: Record<'5m' | '1h' | '24h', number>
  sinceServerStart: string
}

/**
 * Raw heartbeat surface — the markdown body the agent wrote to its heartbeat
 * file plus the file mtime. The Heartbeat tab renders this view-only.
 */
export interface HeartbeatRaw {
  content: string
  lastUpdated: string | null
}

// ─── Agent diagnostics (#385) ────────────────────────────────────────────────

/** Client mirror of a sync-scanner finding (GET /api/agent-packages/{id}/scan). */
export interface ScanFinding {
  type: string
  severity: 'warn' | 'error'
  autoFixable: boolean
  message: string
  agentId?: string
  packageId?: string
  file?: string
  target?: string
  staleInputs?: string[]
  hint?: string
}

/** Client mirror of one timeline event (GET /:agentId/timeline). */
export type TimelineEventView =
  | {
      type: 'run'
      ts: number
      runId: string
      taskId: string
      taskTitle: string | null
      seq: number
      status: 'running' | 'settled' | 'superseded' | 'lost'
      settleReason: string | null
      startedAt: number
      settledAt: number | null
      durationMs: number | null
      model: string | null
      inputTokens: number | null
      outputTokens: number | null
      totalTokens: number | null
      costUsdMicros: number | null
      /** Route receipt (null = pre-migration rows). */
      workClass: string | null
      routeSource: string | null
      logs: Array<{ ts: string; message: string }>
      logsTruncated: boolean
    }
  | {
      type: 'event'
      ts: number
      event: string
      severity: 'info' | 'warn'
      message: string
      taskId: string | null
    }
