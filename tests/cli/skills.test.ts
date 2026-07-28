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
  apiDelete: async (path: string) => {
    calls.push({ method: 'DELETE', path })
    return { ok: true }
  },
  isServerConnectionError: () => false,
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
    requirements: { secrets: [], prereqs: [] },
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

describe('dispatcher wiring', () => {
  it('cli/bakin.ts routes the skills case to the command module', () => {
    const source = readFileSync(join(import.meta.dir, '..', '..', 'cli', 'bakin.ts'), 'utf-8')
    expect(source).toContain("case 'skills':")
    expect(source).toContain("commands/skills")
  })
})
