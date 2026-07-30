/**
 * T13 (#687): the agent mapping lane — mechanical verification is the trust
 * boundary. Injection-shaped proposals (invented env vars, provider-slot
 * grabs, absolute-path "binaries") die in verification; only literally-
 * present names survive, slots are always core-minted skills.*, and apply
 * re-verifies before amending the installed manifest.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-skill-map-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../src/core/system-route', () => ({
  resolveSystemRoute: async () => ({ model: 'test-model', source: 'class' }),
  routeSendArgs: () => ({}),
}))
mock.module('../../src/core/agent-cost', () => ({
  meterAgentTurn: async () => {},
}))

let agentReply = ''
let sendCalls = 0
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      messaging: {
        send: async () => {
          sendCalls += 1
          return { content: agentReply }
        },
      },
      skills: { list: async () => [], get: async () => null, write: async () => {}, remove: async () => {} },
      agents: { list: async () => [], get: async () => null },
    },
  }),
  maybeGetAppServices: () => undefined,
}))

import {
  applyMapping,
  buildMappingPreview,
  extractProposalJson,
  verifyProposal,
} from '../../src/core/agent-packages/skill-mapping'
import { readLockfile, writeLockfile, addPackage } from '../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../packages/core/src/agent-packages/package-paths'
import { parseManifest, type SkillPackManifest } from '../../packages/core/src/agent-packages/manifest'

const SKILL_MD = `---
name: research-helper
description: research things
---
# Research Helper
Export SERPAPI_KEY then run scripts/search.sh (needs ripgrep installed as rg).
`
const SCRIPT = '#!/bin/sh\ncurl -H "Authorization: $SERPAPI_KEY" https://api.example.com | rg pattern\n'

function seedInstalled(): { manifestPath: string; manifest: SkillPackManifest } {
  const lock = addPackage(readLockfile(), 'hub-research-helper@1.0.0', {
    kind: 'skill-pack',
    version: '1.0.0',
    source: 'clawhub:@x/research-helper',
    ref: '1.0.0',
    commitSha: '',
    installedAt: new Date().toISOString(),
    projections: [],
    refCount: 0,
    dependents: [],
  })
  writeLockfile(lock)
  const dir = getPackageSourceDir(testDir, 'skill-pack', 'hub-research-helper', '1.0.0')
  mkdirSync(join(dir, 'skills', 'research-helper', 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'skills', 'research-helper', 'SKILL.md'), SKILL_MD)
  writeFileSync(join(dir, 'skills', 'research-helper', 'scripts', 'search.sh'), SCRIPT)
  const manifest = {
    id: 'hub-research-helper',
    name: 'research-helper',
    version: '1.0.0',
    kind: 'skill-pack' as const,
    contributions: { skills: ['skills/research-helper'] },
    upstream: { source: 'clawhub:@x/research-helper', ref: '1.0.0' },
  }
  const manifestPath = join(dir, 'bakin-package.json')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  return { manifestPath, manifest: parseManifest(manifest) as SkillPackManifest }
}

const FILES = { 'SKILL.md': SKILL_MD, 'scripts/search.sh': SCRIPT }

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  agentReply = ''
  sendCalls = 0
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('verifyProposal — the trust boundary', () => {
  const manifest = parseManifest({
    id: 'hub-x', name: 'x', version: '1.0.0', kind: 'skill-pack',
    contributions: { skills: ['skills/x'] },
  }) as SkillPackManifest

  it('keeps literally-present names, drops invented ones, always mints skills.* slots', () => {
    const result = verifyProposal(
      {
        secrets: [
          { name: 'SERPAPI_KEY' },                    // present → kept
          { name: 'TOTALLY_INVENTED_KEY' },           // absent → dropped
          { name: 'not-env-shaped' },                 // malformed → dropped
        ],
        prereqs: [
          { name: 'rg' },                             // present → kept
          { name: 'made-up-binary' },                 // absent → dropped
          { name: '/usr/bin/evil' },                  // path-shaped → dropped
        ],
        platforms: null,
        notes: null,
      },
      FILES,
      manifest,
      'https://example.dev',
    )
    expect(result.addSecrets).toEqual([{ name: 'SERPAPI_KEY', secretSlot: 'skills.hub-x.SERPAPI_KEY' }])
    expect(result.addPrereqs.map((p) => p.probe)).toEqual(['rg'])
    expect(result.dropped.map((d) => d.name).sort()).toEqual(['/usr/bin/evil', 'TOTALLY_INVENTED_KEY', 'made-up-binary', 'not-env-shaped'])
  })

  it('an agent can never choose the slot — proposals carry no slot field that survives', () => {
    // Even a proposal smuggling a secretSlot key is stripped by the schema
    // upstream; verifyProposal itself only ever mints skills.<NAME>.
    const result = verifyProposal(
      { secrets: [{ name: 'SERPAPI_KEY', help: 'https://serpapi.com' }], prereqs: [], platforms: null, notes: null },
      FILES,
      manifest,
      'https://example.dev',
    )
    expect(result.addSecrets[0]!.secretSlot).toBe('skills.hub-x.SERPAPI_KEY')
  })

  it('dedupes against already-declared legs', () => {
    const declared = parseManifest({
      id: 'hub-x', name: 'x', version: '1.0.0', kind: 'skill-pack',
      contributions: { skills: ['skills/x'] },
      secrets: [{ name: 'SERPAPI_KEY', description: 'd', secretSlot: 'skills.hub-x.SERPAPI_KEY' }],
    }) as SkillPackManifest
    const result = verifyProposal(
      { secrets: [{ name: 'SERPAPI_KEY' }], prereqs: [], platforms: null, notes: null },
      FILES, declared, 'https://example.dev',
    )
    expect(result.addSecrets).toEqual([])
    expect(result.dropped[0]!.reason).toBe('already declared')
  })
})

describe('extractProposalJson', () => {
  it('tolerates fences and trailing prose; rejects no-JSON replies', () => {
    expect(extractProposalJson('```json\n{"secrets":[]}\n```')).toEqual({ secrets: [] })
    expect(extractProposalJson('Here you go: {"secrets":[],"prereqs":[]} hope that helps!')).toEqual({ secrets: [], prereqs: [] })
    expect(() => extractProposalJson('no json here')).toThrow()
  })
})

describe('buildMappingPreview + applyMapping', () => {
  it('end-to-end: turn → verified diff → apply amends the manifest + capability', async () => {
    seedInstalled()
    agentReply = JSON.stringify({
      secrets: [{ name: 'SERPAPI_KEY', help: 'https://serpapi.com/manage-api-key' }, { name: 'FAKE_VAR_NOT_PRESENT' }],
      prereqs: [{ name: 'rg', help: 'https://github.com/BurntSushi/ripgrep' }],
      notes: 'Needs a SerpAPI key and ripgrep.',
    })

    const preview = await buildMappingPreview('research-helper')
    if (!preview.ok) throw new Error(preview.error)
    expect(sendCalls).toBe(1)
    expect(preview.preview.mapping.addSecrets.map((s) => s.name)).toEqual(['SERPAPI_KEY'])
    expect(preview.preview.mapping.dropped.map((d) => d.name)).toContain('FAKE_VAR_NOT_PRESENT')

    const applied = applyMapping('research-helper', preview.preview.mapping)
    expect(applied.ok).toBe(true)

    const dir = getPackageSourceDir(testDir, 'skill-pack', 'hub-research-helper', '1.0.0')
    const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'bakin-package.json'), 'utf-8')))
    if (manifest.kind !== 'skill-pack') throw new Error('expected skill-pack')
    expect(manifest.secrets?.find((s) => s.name === 'SERPAPI_KEY')?.secretSlot).toBe('skills.hub-research-helper.SERPAPI_KEY')
    expect(manifest.requires?.prereqs?.find((p) => p.probe === 'rg')).toBeDefined()
    expect(manifest.capability).toBe('research-helper') // readiness now covers it
    expect(manifest.upstream?.source).toBe('clawhub:@x/research-helper') // provenance survives
  })

  it('a failed turn changes nothing', async () => {
    const { manifestPath } = seedInstalled()
    const before = readFileSync(manifestPath, 'utf-8')
    agentReply = 'I refuse to answer in JSON'
    const preview = await buildMappingPreview('research-helper')
    expect(preview.ok).toBe(false)
    expect(readFileSync(manifestPath, 'utf-8')).toBe(before)
  })

  it('apply re-verifies the wire payload — a tampered mapping is refused', async () => {
    const { manifestPath } = seedInstalled()
    const before = readFileSync(manifestPath, 'utf-8')
    const result = applyMapping('research-helper', {
      addSecrets: [{ name: 'INJECTED_VAR', secretSlot: 'brave.apiKey' }],
      addPrereqs: [],
      dropped: [],
    })
    expect(result.ok).toBe(false)
    expect(readFileSync(manifestPath, 'utf-8')).toBe(before)
  })

  it('unknown skill names error honestly', async () => {
    expect((await buildMappingPreview('nope')).ok).toBe(false)
    expect(sendCalls).toBe(0)
  })
})
