/**
 * Tests for the agent-package skill registry (Phase C-2).
 *
 * Mirrors tests/plugins/workflows/source-registry.test.ts in shape:
 *   - register / unregister round-trip
 *   - cross-package collision throws
 *   - same-package re-registration allowed
 *   - listings + ownership lookup
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SkillDefinition } from '@bakin/core/plugin-types'

const testDir = join(tmpdir(), `bakin-test-agent-pkg-skills-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/task-store', () => ({}))

import {
  clearAgentPackageSkillRegistry,
  getAgentPackageSkillOwner,
  getAgentPackageSkills,
  registerAgentPackageSkill,
  unregisterAgentPackageSkills,
} from '@bakin/workflows/lib/agent-package-skill-registry'

function skill(name: string, body = 'instructions'): SkillDefinition {
  return { name, instructions: body }
}

describe('agent-package skill registry', () => {
  beforeEach(() => {
    clearAgentPackageSkillRegistry()
  })

  it('registers a skill and exposes it via getAgentPackageSkills', () => {
    registerAgentPackageSkill('pixel', 'generate-image', skill('Generate Image', 'do it'))
    const all = getAgentPackageSkills()
    expect(all.has('generate-image')).toBe(true)
    expect(all.get('generate-image')!.name).toBe('Generate Image')
  })

  it('throws when two different packages register the same skill name', () => {
    registerAgentPackageSkill('pixel', 'shared', skill('Pixel'))
    expect(() => registerAgentPackageSkill('rolo', 'shared', skill('Rolo'))).toThrow(
      /already registered/,
    )
  })

  it('lets the same package overwrite its own registration (update)', () => {
    registerAgentPackageSkill('pixel', 'gen', skill('Old', 'old body'))
    expect(() => registerAgentPackageSkill('pixel', 'gen', skill('New', 'new body'))).not.toThrow()
    expect(getAgentPackageSkills().get('gen')!.instructions).toBe('new body')
  })

  it('unregisterAgentPackageSkills removes only that package`s skills', () => {
    registerAgentPackageSkill('pixel', 'a', skill('A'))
    registerAgentPackageSkill('pixel', 'b', skill('B'))
    registerAgentPackageSkill('rolo', 'c', skill('C'))

    unregisterAgentPackageSkills('pixel')

    const remaining = getAgentPackageSkills()
    expect(remaining.has('a')).toBe(false)
    expect(remaining.has('b')).toBe(false)
    expect(remaining.has('c')).toBe(true)
  })

  it('getAgentPackageSkillOwner returns the owning package id', () => {
    registerAgentPackageSkill('pixel', 'gen', skill('Gen'))
    expect(getAgentPackageSkillOwner('gen')).toBe('pixel')
    expect(getAgentPackageSkillOwner('absent')).toBeUndefined()
  })

  it('uses globalThis.__bakinAgentPackageSkills for persistence', () => {
    registerAgentPackageSkill('pixel', 'persisted', skill('Persisted'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (globalThis as any).__bakinAgentPackageSkills
    expect(store).toBeDefined()
    expect(store.agentPackage.has('persisted')).toBe(true)
  })
})
