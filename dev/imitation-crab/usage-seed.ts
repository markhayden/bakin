import { recordUsage } from '../../src/core/usage'

const MCP_TOOLS = [
  'bakin_exec_tasks_list',
  'bakin_exec_tasks_update',
  'bakin_exec_gen_image',
  'bakin_exec_log_progress',
  'bakin_exec_heartbeat',
  'bakin_exec_search',
  'bakin_exec_post_discord',
  'bakin_exec_get_paths',
  'bakin_exec_workflows_start',
  'bakin_exec_messaging_create_session',
]

const REST_ENDPOINTS = [
  'GET /api/tasks',
  'GET /api/agents',
  'GET /api/plugins/assets',
  'GET /api/plugins/health/usage-feed',
  'GET /api/plugins/schedule',
  'POST /api/dispatch',
  'GET /api/search',
  'GET /api/plugins/messaging/sessions',
]

const AGENTS = ['pixel', 'rolo', 'jessica', 'patch']

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function pastTimestamp(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3600_000).toISOString()
}

export function seedMockUsage(): void {
  const entries: Array<{ hoursAgo: number; kind: 'mcp' | 'rest' | 'agent'; name: string; agent: string | null; durationMs: number; status: 'ok' | 'error' }> = []

  for (let i = 0; i < 40; i++) {
    entries.push({
      hoursAgo: Math.random() * 24,
      kind: 'mcp',
      name: randomFrom(MCP_TOOLS),
      agent: randomFrom(AGENTS),
      durationMs: randomBetween(50, 2500),
      status: Math.random() < 0.08 ? 'error' : 'ok',
    })
  }

  for (let i = 0; i < 25; i++) {
    entries.push({
      hoursAgo: Math.random() * 24,
      kind: 'rest',
      name: randomFrom(REST_ENDPOINTS),
      agent: null,
      durationMs: randomBetween(5, 200),
      status: Math.random() < 0.03 ? 'error' : 'ok',
    })
  }

  for (let i = 0; i < 15; i++) {
    const agent = randomFrom(AGENTS)
    entries.push({
      hoursAgo: Math.random() * 24,
      kind: 'agent',
      name: `dispatch:${agent}`,
      agent,
      durationMs: randomBetween(3000, 45000),
      status: Math.random() < 0.1 ? 'error' : 'ok',
    })
  }

  entries.sort((a, b) => b.hoursAgo - a.hoursAgo)

  for (const e of entries) {
    recordUsage({
      ts: pastTimestamp(e.hoursAgo),
      kind: e.kind,
      name: e.name,
      agent: e.agent,
      durationMs: e.durationMs,
      status: e.status,
    })
  }

  console.log(`[mock] Seeded ${entries.length} usage entries for health dashboard`)
}
