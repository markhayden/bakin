/** Lightweight agent info for badges, dropdowns, selectors */
export interface AgentMeta {
  id: string
  name: string
  emoji: string
  role: string
  headshot: string
}

/** Full agent profile merged from OpenClaw config + workspace files */
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
 * The server today returns 4 states (`absent | unmanaged | adopted | managed`).
 * `drifted` and `update-available` are declared on the badge component for
 * forward-compat — wiring handles them but the API doesn't yet emit them.
 */
export interface PackageStateRow {
  agentId: string
  state: 'absent' | 'unmanaged' | 'adopted' | 'managed' | 'drifted' | 'update-available'
  packageId?: string
  entry?: {
    source: string
    ref: string
    commitSha: string
    installedAt: string
    version?: string
    dependencies?: string[]
  }
}
