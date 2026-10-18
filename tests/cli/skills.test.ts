/**
 * T11 (#687): `bakin skills` CLI — behavioral tests over a mocked HTTP
 * layer (thin-client rule: the CLI never touches core modules directly),
 * plus dispatcher wiring smoke.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-cli-skills-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

const calls: Array<{ method: string; path: string; body?: unknown }> = []
let getResponses: Record<string, unknown> = {}
let postResponses: Record<string, unknown> = {}

mock.module('../../src/cli/http', () => ({
  BASE_URL: 'http://localhost:3737',
  apiGet: async (path: string) => {
    calls.push({ method: 'GET', path })
    return getResponses[path] ?? {}
  },
  apiPost: async (path: string, body?: unknown) => {
    calls.push({ method: 'POST', path, body })
    return postResponses[path] ?? {}
  },
  // Mirrors the REAL client: returns {ok, data} rather than throwing, which
  // is exactly why the command uses it for the refusal/error branches.
  apiPostJson: async (path: string, body?: unknown) => {
    calls.push({ method: 'POST', path, body })
    const data = postResponses[path] ?? {}
    const okFlag = (data as { ok?: boolean }).ok
    return { ok: okFlag !== false, data }
  },
  apiDelete: async (path: string) => {
    calls.push({ method: 'DELETE', path })
    return { ok: true }
  },
  isServerConnectionError: () => false,
  jsonObject: (value: unknown) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null),
}))
// The routes are operations (#895); following them is covered by the
// operation-command and route suites. Here an operation settles at once with
// the body the mocked route answered.
mock.module('../../src/cli/operation-command', () => ({
  startAndFollow: async (start: () => Promise<unknown>) => {
    const body = await start() as Record<string, unknown>
    const failed = body?.ok === false
    return { follow: { phase: 'finished', operation: null, children: [] }, body, httpStatus: failed ? 400 : 200, exitCode: failed ? 1 : 0 }
  },
  operationBody: (operation: { body: Record<string, unknown> | null }) => operation.body ?? {},
  exitOnFailure: () => {},
}))

import { run } from '../../src/cli/commands/skills'

const PREVIEW = {
  ok: true,
  preview: {
    ref: 'clawhub:@steipete/weather',
    packageId: 'hub-weather',
    skillName: 'weather',
    version: '2.0.1',
    sourceKind: 'clawhub',
    pinnedRef: '2.0.1',
    files: [{ path: 'SKILL.md', bytes: 120 }],
    requirements: { secrets: [], prereqs: [], bins: [], npm: [], models: [], dependencies: [] },
    mentions: [],
    warnings: [],
    risk: [],
    verdictState: 'clean',
    consentToken: 'tok-1',
  },
}

let logs: string[] = []
const origLog = console.log
const origErr = console.error

beforeEach(() => {
  calls.length = 0
  logs = []
  getResponses = {}
  postResponses = {}
  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '))
  }
  console.error = (...args: unknown[]) => {
    logs.push(args.join(' '))
  }
})

function restoreConsole(): void {
  console.log = origLog
  console.error = origErr
}

describe('bakin skills install --yes', () => {
  it('previews, consents, installs, and prints the result', async () => {
    postResponses['/api/skills/preview'] = PREVIEW
    postResponses['/api/skills/install'] = { ok: true, installed: { packageId: 'hub-weather', kind: 'skill-pack' }, warnings: [] }
    getResponses['/api/packages/capabilities'] = { capabilities: [] }
    try {
      await run(['skills', 'install', 'https://clawhub.ai/steipete/skills/weather', '--yes'])
    } finally {
      restoreConsole()
    }
    const install = calls.find((c) => c.path === '/api/skills/install')
    expect(install?.body).toMatchObject({ consentToken: 'tok-1' })
    expect(logs.join('\n')).toContain('✓ Installed weather v2.0.1')
    expect(logs.join('\n')).toContain('verdict: clean')
  })
})

describe('bakin skills list', () => {
  it('renders managed and unmanaged sections', async () => {
    getResponses['/api/skills'] = {
      managed: [{ skillName: 'weather', packageId: 'hub-weather@2.0.1', version: '2.0.1', source: 'clawhub:@steipete/weather', hub: true }],
      unmanaged: [{ name: 'hand-rolled', scope: 'global' }],
    }
    try {
      await run(['skills', 'list'])
    } finally {
      restoreConsole()
    }
    const out = logs.join('\n')
    expect(out).toContain('weather  v2.0.1  [hub]')
    expect(out).toContain('hand-rolled')
  })
})

describe('bakin skills remove', () => {
  it('resolves bare names to lockfile keys (D19)', async () => {
    getResponses['/api/skills'] = {
      managed: [{ skillName: 'weather', packageId: 'hub-weather@2.0.1', version: '2.0.1', source: 'x', hub: true }],
      unmanaged: [],
    }
    try {
      await run(['skills', 'remove', 'weather'])
    } finally {
      restoreConsole()
    }
    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.path).toBe(`/api/packages/${encodeURIComponent('hub-weather@2.0.1')}`)
    expect(logs.join('\n')).toContain('✓ Removed weather')
  })
})

describe('bakin skills map', () => {
  const mapping = {
    addSecrets: [{ name: 'WEATHER_API_KEY', secretSlot: 'skills.hub-weather.WEATHER_API_KEY' }],
    addPrereqs: [],
    dropped: [],
  }

  it('--yes previews the mapping (an operation), then applies exactly that mapping', async () => {
    postResponses['/api/skills/map/preview'] = { ok: true, preview: { skillName: 'weather', packageKey: 'hub-weather@2.0.1', mapping } }
    postResponses['/api/skills/map/apply'] = { ok: true, applied: true }
    getResponses['/api/packages/capabilities'] = { capabilities: [] }
    try {
      await run(['skills', 'map', 'weather', '--yes'])
    } finally {
      restoreConsole()
    }
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/skills/map/preview', '/api/skills/map/apply'])
    expect(calls.find((c) => c.path === '/api/skills/map/apply')?.body).toEqual({ name: 'weather', mapping })
    expect(logs.join('\n')).toContain('✓ Mapping applied')
  })

  it('a busy apply prints the message naming the holder and exits non-zero', async () => {
    postResponses['/api/skills/map/preview'] = { ok: true, preview: { skillName: 'weather', packageKey: 'hub-weather@2.0.1', mapping } }
    postResponses['/api/skills/map/apply'] = { ok: false, error: 'install_busy', message: 'Install plugin notes is using install-state — try again when it finishes.' }
    const exit = process.exit
    process.exit = ((code?: number) => { throw new Error(`exit:${code}`) }) as never
    try {
      await expect(run(['skills', 'map', 'weather', '--yes'])).rejects.toThrow('exit:1')
    } finally {
      process.exit = exit
      restoreConsole()
    }
    expect(logs.join('\n')).toContain('Install plugin notes is using install-state')
  })
})

describe('dispatcher wiring', () => {
  it('cli/bakin.ts routes the skills case to the command module', () => {
    const source = readFileSync(join(import.meta.dir, '..', '..', 'cli', 'bakin.ts'), 'utf-8')
    expect(source).toContain("case 'skills':")
    expect(source).toContain("commands/skills")
  })
})
