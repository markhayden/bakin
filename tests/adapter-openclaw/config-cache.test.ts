import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readOpenClawConfig, resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'

describe('OpenClaw config cache', () => {
  const originalOpenClawHome = process.env.OPENCLAW_HOME
  const homes: string[] = []

  beforeEach(() => {
    resetOpenClawConfigCache()
  })

  afterEach(() => {
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    resetOpenClawConfigCache()
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true })
    }
  })

  function writeConfig(name: string, mtime: Date): string {
    const home = mkdtempSync(join(tmpdir(), 'bakin-openclaw-cache-'))
    homes.push(home)
    mkdirSync(home, { recursive: true })
    const path = join(home, 'openclaw.json')
    writeFileSync(path, JSON.stringify({
      agents: { list: [{ id: 'main', identity: { name } }] },
    }), 'utf-8')
    utimesSync(path, mtime, mtime)
    return home
  }

  it('does not reuse cached config when OPENCLAW_HOME changes to a same-mtime file', () => {
    const mtime = new Date('2026-01-01T00:00:00.000Z')
    const first = writeConfig('First', mtime)
    const second = writeConfig('Second', mtime)

    process.env.OPENCLAW_HOME = first
    expect(readOpenClawConfig()?.agents?.list?.[0]?.identity?.name).toBe('First')

    process.env.OPENCLAW_HOME = second
    expect(readOpenClawConfig()?.agents?.list?.[0]?.identity?.name).toBe('Second')
  })
})
