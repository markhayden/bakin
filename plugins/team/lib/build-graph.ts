/**
 * Pyramid layout for the team grid — pure function, no React.
 *
 * Root is always the main agent (resolved from `mainAgentId` in the store,
 * which comes from the team plugin roster route). Teams in `team.json` whose
 * `reportsTo` is null/undefined are resolved at render time to `mainAgentId`. Teams
 * whose `reportsTo` points at an unknown agent fall back to main as well
 * — we don't crash and we don't orphan them.
 *
 * Row shape:
 *   0  Founder (Mark)
 *   1  Main agent card (if resolvable, otherwise empty)
 *   2  Team section headers + non-main team-leader cards
 *   3  Team member cards
 *   +  Unassigned bucket for agents that don't belong to any rendered team
 */
import type { Node, Edge } from '@xyflow/react'
import type { AgentWithStatus, AgentDisplaySettingsMap, OrgTeam } from '../types'

// ─── Layout constants ───────────────────────────────────────────────────────

export const CARD_W = 208
export const CARD_H = 320
export const X_GAP = 28
export const Y_GAP = 56
const TEAM_GAP = 80
const SECTION_W = 200
const FOUNDER_W = CARD_W
const FOUNDER_ROW_H = 80
const SECTION_ROW_H = 30

const EDGE_STYLE: Record<string, unknown> = {
  stroke: 'var(--bakin-color-border-subtle)',
  strokeWidth: 2,
}
const EDGE_DASHED: Record<string, unknown> = { ...EDGE_STYLE }

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BuildGraphInput {
  agents: AgentWithStatus[]
  teams: OrgTeam[]
  displaySettings: AgentDisplaySettingsMap
  /** Canonical main/orchestrator agent id. Null when the roster is broken. */
  mainAgentId: string | null
  /** Team ids whose shared context file has content (rules badge on the section node). */
  teamsWithContext?: Set<string>
}

export interface BuildGraphResult {
  nodes: Node[]
  edges: Edge[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function placeRow(agents: AgentWithStatus[], y: number, nodes: Node[]): void {
  const totalW = agents.length * CARD_W + Math.max(0, agents.length - 1) * X_GAP
  const startX = -totalW / 2
  agents.forEach((agent, i) => {
    nodes.push({
      id: agent.id,
      type: 'agentCard',
      position: { x: startX + i * (CARD_W + X_GAP), y },
      data: { agent },
    })
  })
}

/**
 * Resolve a team's effective reporter — treat null/undefined/empty/unknown as
 * "reports to main". The OrgTeam.reportsTo field is typed string, but legacy
 * team.json files may contain null, missing fields, or stale agent ids.
 */
function resolveReporter(
  team: OrgTeam,
  agentIds: Set<string>,
  mainAgentId: string | null,
): string | null {
  const raw = (team as { reportsTo?: string | null }).reportsTo
  if (!raw) return mainAgentId
  if (!agentIds.has(raw)) return mainAgentId
  return raw
}

// ─── Main ──────────────────────────────────────────────────────────────────

/**
 * Build the pyramid graph. Deterministic and pure — call with identical
 * inputs and you'll get identical output.
 */
export function buildGraph(input: BuildGraphInput): BuildGraphResult {
  const { agents, teams, displaySettings, mainAgentId, teamsWithContext } = input
  const nodes: Node[] = []
  const edges: Edge[] = []
  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const agentIds = new Set(agentMap.keys())

  // Sort teams by order for stable rendering
  const sortedTeams = [...teams].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  // Map teamId → member agents (from displaySettings)
  const teamMembers = new Map<string, AgentWithStatus[]>()
  for (const team of sortedTeams) teamMembers.set(team.id, [])
  const assignedIds = new Set<string>()
  for (const agent of agents) {
    const teamId = displaySettings[agent.id]?.teamId
    if (teamId && teamMembers.has(teamId)) {
      teamMembers.get(teamId)!.push(agent)
      assignedIds.add(agent.id)
    }
  }

  // Resolve each team's reporter (reportsTo ?? mainAgentId), then group
  // teams by their effective reporter.
  const teamsByReporter = new Map<string, OrgTeam[]>()
  for (const team of sortedTeams) {
    const reporter = resolveReporter(team, agentIds, mainAgentId)
    if (!reporter) continue // no main agent and no valid reporter — skip
    const list = teamsByReporter.get(reporter) ?? []
    list.push(team)
    teamsByReporter.set(reporter, list)
  }

  // ─── Row 0: Founder ──────────────────────────────────────────────────────
  let y = 0
  nodes.push({
    id: 'mark',
    type: 'founder',
    position: { x: -FOUNDER_W / 2, y },
    data: { label: 'Founder' },
  })
  y += FOUNDER_ROW_H + Y_GAP

  // ─── Row 1: Main agent ───────────────────────────────────────────────────
  const mainAgent =
    mainAgentId && agentMap.has(mainAgentId) ? agentMap.get(mainAgentId)! : null

  if (mainAgent) {
    placeRow([mainAgent], y, nodes)
    assignedIds.add(mainAgent.id)
    edges.push({
      id: `mark->${mainAgent.id}`,
      source: 'mark',
      target: mainAgent.id,
      type: 'default',
      style: EDGE_STYLE,
    })
    y += CARD_H + Y_GAP
  }

  // ─── Row 2: Non-main team leaders (sub-orgs) ─────────────────────────────
  // An agent is a "non-main team leader" when a team's reportsTo points at
  // them AND they're not the main agent. In the default flat config there
  // are none — all teams resolve to main.
  const nonMainLeaderIds: string[] = []
  for (const reporter of teamsByReporter.keys()) {
    if (reporter === mainAgentId) continue
    if (!agentMap.has(reporter)) continue
    nonMainLeaderIds.push(reporter)
  }

  if (nonMainLeaderIds.length > 0) {
    const leaders = nonMainLeaderIds.map((id) => agentMap.get(id)!)
    placeRow(leaders, y, nodes)
    for (const leader of leaders) {
      assignedIds.add(leader.id)
      // Wire them back up to main (if main exists), so the org stays connected
      if (mainAgent) {
        edges.push({
          id: `${mainAgent.id}->${leader.id}`,
          source: mainAgent.id,
          target: leader.id,
          type: 'default',
          style: EDGE_STYLE,
        })
      }
    }
    y += CARD_H + Y_GAP
  }

  // ─── Rows 3+: team sections and members, grouped by reporter ─────────────
  // Render each reporter's teams in one horizontal strip. Order: main first,
  // then non-main leaders in insertion order.
  const reporterOrder: string[] = []
  if (mainAgentId && teamsByReporter.has(mainAgentId)) reporterOrder.push(mainAgentId)
  for (const id of nonMainLeaderIds) {
    if (teamsByReporter.has(id)) reporterOrder.push(id)
  }

  // Synthesize a default "All Agents" section when there are no teams at all
  // and we have a main agent with subagents. This gives fresh installs a
  // visible pyramid shape without requiring the user to define any teams.
  const needsSynthetic =
    sortedTeams.length === 0 &&
    mainAgent !== null &&
    agents.some((a) => a.id !== mainAgent!.id)

  for (const reporterId of reporterOrder) {
    const teamsForReporter = teamsByReporter.get(reporterId) ?? []
    if (teamsForReporter.length === 0) continue

    const teamWidths: number[] = []
    const teamMembersList: AgentWithStatus[][] = []
    for (const team of teamsForReporter) {
      const members = teamMembers.get(team.id) ?? []
      teamMembersList.push(members)
      const w = Math.max(1, members.length) * CARD_W + Math.max(0, members.length - 1) * X_GAP
      teamWidths.push(w)
    }

    const totalTeamWidth =
      teamWidths.reduce((a, b) => a + b, 0) + Math.max(0, teamsForReporter.length - 1) * TEAM_GAP
    let teamX = -totalTeamWidth / 2

    // Section headers
    const sectionY = y
    for (let t = 0; t < teamsForReporter.length; t++) {
      const team = teamsForReporter[t]
      const centerX = teamX + teamWidths[t] / 2
      nodes.push({
        id: `section-${team.id}`,
        type: 'section',
        position: { x: centerX - SECTION_W / 2, y: sectionY },
        data: { label: team.label, teamId: team.id, hasContext: teamsWithContext?.has(team.id) ?? false },
      })
      edges.push({
        id: `${reporterId}->section-${team.id}`,
        source: reporterId,
        target: `section-${team.id}`,
        type: 'default',
        style: EDGE_STYLE,
      })
      teamX += teamWidths[t] + TEAM_GAP
    }

    y += SECTION_ROW_H + Y_GAP

    // Member cards
    teamX = -totalTeamWidth / 2
    for (let t = 0; t < teamsForReporter.length; t++) {
      const team = teamsForReporter[t]
      const members = teamMembersList[t]
      const memberStartX = teamX

      members.forEach((agent, i) => {
        const x = memberStartX + i * (CARD_W + X_GAP)
        nodes.push({
          id: agent.id,
          type: 'agentCard',
          position: { x, y },
          data: { agent },
        })
        edges.push({
          id: `section-${team.id}->${agent.id}`,
          source: `section-${team.id}`,
          target: agent.id,
          type: 'default',
          style: EDGE_DASHED,
        })
      })

      teamX += teamWidths[t] + TEAM_GAP
    }

    if (teamMembersList.some((m) => m.length > 0)) {
      y += CARD_H + Y_GAP
    }
  }

  // Synthesized default section: fresh installs only.
  if (needsSynthetic && mainAgent) {
    const subagents = agents.filter((a) => a.id !== mainAgent.id)
    const totalW = subagents.length * CARD_W + Math.max(0, subagents.length - 1) * X_GAP

    nodes.push({
      id: 'section-all',
      type: 'section',
      position: { x: -SECTION_W / 2, y },
      data: { label: 'All agents' },
    })
    edges.push({
      id: `${mainAgent.id}->section-all`,
      source: mainAgent.id,
      target: 'section-all',
      type: 'default',
      style: EDGE_STYLE,
    })
    y += SECTION_ROW_H + Y_GAP

    const startX = -totalW / 2
    subagents.forEach((agent, i) => {
      nodes.push({
        id: agent.id,
        type: 'agentCard',
        position: { x: startX + i * (CARD_W + X_GAP), y },
        data: { agent },
      })
      edges.push({
        id: `section-all->${agent.id}`,
        source: 'section-all',
        target: agent.id,
        type: 'default',
        style: EDGE_DASHED,
      })
      assignedIds.add(agent.id)
    })
    if (subagents.length > 0) y += CARD_H + Y_GAP
  }

  // ─── Unassigned bucket ──────────────────────────────────────────────────
  // Agents that never got placed: not main, not a team leader, not a team
  // member. In the default flat config (no teams defined) the synthetic
  // section picks everyone up and this bucket stays empty.
  //
  // If the main agent is missing (broken roster), we bail out here and show
  // founder only — per T5 spec, an empty pyramid is the correct degraded
  // state. Rendering orphan subagents when the orchestrator is gone would
  // misrepresent the org.
  const unassigned = mainAgent ? agents.filter((a) => !assignedIds.has(a.id)) : []
  if (unassigned.length > 0) {
    nodes.push({
      id: 'section-unassigned',
      type: 'section',
      position: { x: -SECTION_W / 2, y },
      data: { label: 'Unassigned' },
    })
    y += SECTION_ROW_H + Y_GAP

    placeRow(unassigned, y, nodes)
    for (const agent of unassigned) {
      edges.push({
        id: `unassigned->${agent.id}`,
        source: 'section-unassigned',
        target: agent.id,
        type: 'default',
        style: EDGE_DASHED,
      })
    }
  }

  return { nodes, edges: edges.map((e) => ({ ...e, animated: true })) }
}
