/**
 * GET /api/agents/health — enriched heartbeat roll-up with staleness.
 *
 * Migrated from src/app/api/agents/health/route.ts for Phase B of #147.
 */
import { readHeartbeats } from '@/lib/content-files'

const STALE_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes

export async function get(_req: Request, _url: URL): Promise<Response> {
  const raw = readHeartbeats()
  const now = Date.now()

  // Enrich each heartbeat with computed staleness
  const enriched: Record<string, unknown> = {}
  for (const [id, data] of Object.entries(raw)) {
    const hb = data as Record<string, unknown>
    const ts = hb.timestamp as string | undefined
    const age = ts ? now - new Date(ts).getTime() : Infinity
    enriched[id] = {
      ...hb,
      stale: age > STALE_THRESHOLD_MS,
      ageMs: age === Infinity ? null : age,
    }
  }

  return Response.json(enriched)
}
