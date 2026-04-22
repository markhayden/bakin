/**
 * GET/PUT /api/agents/settings — agents plugin configuration.
 *
 * Migrated from src/app/api/agents/settings/route.ts for Phase B of #147.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '@/core/content-dir'

function getSettingsPath(): string {
  return join(getContentDir(), 'plugin-settings', 'agents.json')
}

export async function get(_req: Request, _url: URL): Promise<Response> {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    return Response.json({})
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return Response.json(data)
  } catch {
    return Response.json({})
  }
}

export async function put(req: Request, _url: URL): Promise<Response> {
  const body = await req.json()
  const path = getSettingsPath()
  const dir = join(getContentDir(), 'plugin-settings')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(path, JSON.stringify(body, null, 2))
  return Response.json({ ok: true })
}
