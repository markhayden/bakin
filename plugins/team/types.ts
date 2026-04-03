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
  reportsTo: string   // agent ID this team reports to (e.g. "main-operator")
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
