import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const CONTENT_DIR = join(process.cwd(), 'content')

export async function GET() {
  const auditPath = join(CONTENT_DIR, 'audit.jsonl')
  if (!existsSync(auditPath)) return NextResponse.json({ entries: [] })

  try {
    const raw = readFileSync(auditPath, 'utf-8')
    const entries = raw
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line) } catch { return null }
      })
      .filter(Boolean)
      .reverse() // newest first
      .slice(0, 500)
    return NextResponse.json({ entries })
  } catch {
    return NextResponse.json({ entries: [] })
  }
}
