import { NextResponse } from 'next/server'
import { readHeartbeats } from '@/lib/content'

const STALE_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes

export async function GET() {
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

  return NextResponse.json(enriched)
}
