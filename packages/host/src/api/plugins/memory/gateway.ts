/**
 * GET /api/plugins/memory/gateway - paginated runtime gateway log view.
 */
import { getAppServices } from '@/core/app-services'

const GATEWAY_LOG_TIER = 'runtime-gateway-log'

export async function get(_req: Request, url: URL): Promise<Response> {
  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const offset = parseInt(url.searchParams.get('offset') || '0', 10)
  const limit = parseInt(url.searchParams.get('limit') || '100', 10)

  try {
    const entry = await getAppServices().runtime.memory.getEntry(GATEWAY_LOG_TIER, date)
    if (!entry?.content) {
      return Response.json({ entries: [], total: 0, hasMore: false })
    }

    const raw = entry.content
    const lines = raw.split('\n').filter(Boolean)

    const entries = lines
      .map((line, i) => {
        // Parse structured log lines: "2026-03-19T... level subsystem {...} message"
        const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
        const levelMatch = line.match(/\s(info|warn|error|debug)\s/)
        const msgMatch = line.match(/}\s(.+)$/)

        return {
          id: `${date}-${i}`,
          ts: tsMatch?.[1] || '',
          level: levelMatch?.[1] || 'info',
          message: msgMatch?.[1]?.trim() || line.slice(0, 200),
          raw: line,
        }
      })
      .reverse()

    const total = entries.length
    const page = entries.slice(offset, offset + limit)

    return Response.json({ entries: page, total, hasMore: offset + limit < total })
  } catch {
    return Response.json({ entries: [], total: 0, hasMore: false })
  }
}
