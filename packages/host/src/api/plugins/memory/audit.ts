/**
 * GET /api/plugins/memory/audit — recent entries from audit.jsonl
 * (newest first, capped at 500). Used by the memory observability
 * dashboard to render the audit tier.
 *
 * Migrated from src/app/api/plugins/memory/audit/route.ts for Phase B
 * of #147.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'

const CONTENT_DIR = getContentDir()

export async function get(_req: Request, _url: URL): Promise<Response> {
  const auditPath = join(CONTENT_DIR, 'audit.jsonl')
  if (!existsSync(auditPath)) return Response.json({ entries: [] })

  try {
    const raw = readFileSync(auditPath, 'utf-8')
    const entries = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(Boolean)
      .reverse() // newest first
      .slice(0, 500)
    return Response.json({ entries })
  } catch {
    return Response.json({ entries: [] })
  }
}
