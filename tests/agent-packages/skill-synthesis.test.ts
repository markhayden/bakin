/**
 * Manifest synthesis for raw Agent-Skills bundles (#687, D12).
 *
 * A staged dir containing SKILL.md becomes a normal skill-pack: frontmatter
 * fast-path, the FROZEN metadata.openclaw translation table (never extended —
 * pinned below), binary-file refusal, claim-free env-var mentions scan, and
 * an upstream provenance stanza. SKILL.md is NEVER rewritten.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-synthesis-${Date.now()}-${randomUUID()}`)

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

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
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  FROZEN_TRANSLATION_KEYS,
  synthesizeSkillPack,
} from '../../src/core/agent-packages/skill-synthesis'
import { parseManifest } from '../../packages/core/src/agent-packages/manifest'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'skill-bundles')

let stagingSeq = 0
function stage(fixture: string): string {
  const dir = join(testDir, `staging-${stagingSeq++}`)
  cpSync(join(FIXTURES, fixture), dir, { recursive: true })
  return dir
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('synthesis — clawhub-style bundle with requirements', () => {
  it('produces a valid skill-pack with the frozen translation applied', () => {
    const dir = stage('clawhub-style')
    const result = synthesizeSkillPack(dir, {
      source: 'clawhub:@acme/ebay-research',
      ref: '1.2.0',
      resolvedSha: 'c'.repeat(64),
    })
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)

    // The written manifest parses as a real skill-pack.
    const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'bakin-package.json'), 'utf-8')))
    if (manifest.kind !== 'skill-pack') throw new Error('expected skill-pack')

    expect(manifest.id).toBe('hub-ebay-research')
    expect(manifest.version).toBe('1.2.0')
    expect(manifest.contributions.skills).toEqual(['skills/ebay-research'])
    expect(manifest.upstream).toEqual({
      source: 'clawhub:@acme/ebay-research',
      ref: '1.2.0',
      resolvedSha: 'c'.repeat(64),
    })

    // env → secrets with the FORCED skills.* slot namespace
    const secrets = manifest.secrets ?? []
    const primary = secrets.find((s) => s.name === 'EBAY_API_KEY')
    expect(primary?.required).toBe(true)
    expect(primary?.secretSlot).toBe('skills.EBAY_API_KEY')
    const optional = secrets.find((s) => s.name === 'EBAY_OPTIONAL_AFFILIATE_ID')
    expect(optional?.required).toBe(false)

    // bins → probe-only prereqs; anyBins members are optional
    const prereqs = manifest.requires?.prereqs ?? []
    expect(prereqs.find((p) => p.probe === 'jq')?.optional).toBe(false)
    expect(prereqs.find((p) => p.probe === 'curl')?.optional).toBe(true)
    expect(prereqs.find((p) => p.probe === 'wget')?.optional).toBe(true)
    // NO auto-install legs are ever synthesized (ClawHavoc vector).
    expect(manifest.requires?.bins).toBeUndefined()

    // os → platform expansion
    expect(manifest.platforms).toEqual(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'])

    // requirement-bearing → capability slug so readiness covers it
    expect(manifest.capability).toBe('ebay-research')
  })

  it('moves the bundle into skills/<name>/ with SKILL.md byte-identical', () => {
    const original = readFileSync(join(FIXTURES, 'clawhub-style', 'SKILL.md'), 'utf-8')
    const dir = stage('clawhub-style')
    const result = synthesizeSkillPack(dir, { source: 'clawhub:@acme/ebay-research' })
    expect(result.ok).toBe(true)
    expect(readFileSync(join(dir, 'skills', 'ebay-research', 'SKILL.md'), 'utf-8')).toBe(original)
    expect(existsSync(join(dir, 'skills', 'ebay-research', 'scripts', 'fetch.sh'))).toBe(true)
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(false)
  })
})

describe('synthesis — bare bundle', () => {
  it('fast-path: no requirements → no capability, no secret legs, version fallback', () => {
    const dir = stage('bare-style')
    const result = synthesizeSkillPack(dir, { source: 'github:acme/skills#commit-messages', hubVersion: '3.1.0' })
    if (!result.ok) throw new Error(result.error)
    const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'bakin-package.json'), 'utf-8')))
    if (manifest.kind !== 'skill-pack') throw new Error('expected skill-pack')
    expect(manifest.id).toBe('hub-commit-messages')
    expect(manifest.version).toBe('3.1.0') // frontmatter has none → hub-resolved
    expect(manifest.capability).toBeUndefined()
    expect(manifest.secrets ?? []).toEqual([])
    expect(manifest.platforms).toBeUndefined()
  })
})

describe('synthesis — refusals', () => {
  it('refuses bundles containing binary files, naming them', () => {
    const dir = stage('binary-file')
    const result = synthesizeSkillPack(dir, { source: 'clawhub:@x/logo-stamper' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('binary-files')
    expect(result.binaryFiles).toEqual(['assets/logo.png'])
  })

  it('refuses dirs without a SKILL.md', () => {
    const dir = join(testDir, 'empty-bundle')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'notes.md'), 'not a skill')
    const result = synthesizeSkillPack(dir, { source: './empty-bundle' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no-skill-md')
  })
})

describe('synthesis — malicious-shaped content stays inert', () => {
  it('translates nothing, executes nothing, and the mentions scan surfaces prose env vars', () => {
    const dir = stage('malicious-shaped')
    const result = synthesizeSkillPack(dir, { source: 'clawhub:@evil/totally-legit-helper' })
    if (!result.ok) throw new Error(result.error)
    // No metadata.openclaw → no translated legs, no capability.
    const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'bakin-package.json'), 'utf-8')))
    if (manifest.kind !== 'skill-pack') throw new Error('expected skill-pack')
    expect(manifest.capability).toBeUndefined()
    expect(manifest.secrets ?? []).toEqual([])
    // Claim-free mentions line for the preview.
    expect(result.mentions).toContain('OPENAI_API_KEY')
    expect(result.mentions).toContain('AWS_SECRET_ACCESS_KEY')
    // The fake install step rode along VERBATIM (never executed, shown in preview).
    expect(readFileSync(join(dir, 'skills', 'totally-legit-helper', 'SKILL.md'), 'utf-8')).toContain('curl -fsSL')
  })
})

describe('synthesis — name/version sanitization', () => {
  it('sanitizes a display-style name with a warning', () => {
    const dir = join(testDir, 'display-name')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: My Cool Skill\ndescription: does things\n---\n# hi')
    const result = synthesizeSkillPack(dir, { source: './display-name' })
    if (!result.ok) throw new Error(result.error)
    const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'bakin-package.json'), 'utf-8')))
    expect(manifest.id).toBe('hub-my-cool-skill')
    expect(result.warnings.some((w) => w.includes('My Cool Skill'))).toBe(true)
  })

  it('accepts lowercase skill.md and falls back to 0.0.0 with no version anywhere', () => {
    const dir = join(testDir, 'lc-skill')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'skill.md'), '---\nname: lc\ndescription: d\n---\n# lc')
    const result = synthesizeSkillPack(dir, { source: './lc-skill' })
    if (!result.ok) throw new Error(result.error)
    const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'bakin-package.json'), 'utf-8')))
    expect(manifest.version).toBe('0.0.0')
  })
})

describe('the frozen table is FROZEN', () => {
  it('translation keys never grow without touching the spec (D12)', () => {
    // Extending this list requires a spec change — the whole point of #687's
    // design is that new dialects route to the agent mapping lane, not here.
    expect(FROZEN_TRANSLATION_KEYS).toEqual([
      'metadata.openclaw.requires.env',
      'metadata.openclaw.requires.bins',
      'metadata.openclaw.requires.anyBins',
      'metadata.openclaw.envVars',
      'metadata.openclaw.primaryEnv',
      'metadata.openclaw.os',
    ])
  })
})
