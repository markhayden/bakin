import { NextResponse, type NextRequest } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const LOG_DIR = '/tmp/openclaw'

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0', 10)
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100', 10)

  const logPath = join(LOG_DIR, `openclaw-${date}.log`)

  if (!existsSync(logPath)) {
    return NextResponse.json({ entries: [], total: 0, hasMore: false })
  }

  try {
    const raw = readFileSync(logPath, 'utf-8')
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

    return NextResponse.json({ entries: page, total, hasMore: offset + limit < total })
  } catch {
    return NextResponse.json({ entries: [], total: 0, hasMore: false })
  }
}
