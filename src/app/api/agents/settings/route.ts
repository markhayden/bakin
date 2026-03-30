import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'

function getSettingsPath(): string {
  return join(getContentDir(), 'plugin-settings', 'agents.json')
}

export async function GET() {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    return NextResponse.json({})
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({})
  }
}

export async function PUT(req: Request) {
  const body = await req.json()
  const path = getSettingsPath()
  const dir = join(getContentDir(), 'plugin-settings')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(path, JSON.stringify(body, null, 2))
  return NextResponse.json({ ok: true })
}
