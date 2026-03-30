import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'
import { pluginRegistry } from '@/lib/plugin-registry'

function getSettingsPath(pluginId: string): string {
  return join(getContentDir(), 'plugin-settings', `${pluginId}.json`)
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  const { pluginId } = await params
  const path = getSettingsPath(pluginId)
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

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  const { pluginId } = await params
  const body = await req.json()
  const path = getSettingsPath(pluginId)
  const dir = join(getContentDir(), 'plugin-settings')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(path, JSON.stringify(body, null, 2))

  // Notify the plugin of settings change
  pluginRegistry.notifySettingsChange(pluginId, body).catch(() => {})

  return NextResponse.json({ ok: true })
}
