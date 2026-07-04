import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// CC-6 isolation mocks (added when phase C-2 of agent-packages extended this
// loader). The legacy block below already passes a tmp dir explicitly to
// every loadSkill() call, but agent-package + plugin skill resolution paths
// pull from in-memory registries that can reach into the real ~/.bakin/ if
// the harness ever changed. Mocking is cheap insurance.
const mockTestDir = join(tmpdir(), `bakin-test-skill-loader-mock-${Date.now()}`)
mock.module('@/core/content-dir', () => ({
  getContentDir: () => mockTestDir,
  getBakinPaths: () => ({ workflows: join(mockTestDir, 'workflows') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => mockTestDir,
  getBakinPaths: () => ({ workflows: join(mockTestDir, 'workflows') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(mockTestDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(mockTestDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/task-store', () => ({}))

import { loadSkill, listAllSkills, invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'
import {
  clearAgentPackageSkillRegistry,
  registerAgentPackageSkill,
} from '@bakin/core/workflows/agent-package-skill-registry'

describe('skill-loader', () => {
  const testDir = join(tmpdir(), `bakin-test-skills-${Date.now()}`)
  const skillsDir = join(testDir, 'workflows', 'skills')

  beforeEach(() => {
    invalidateSkillCache()
    mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('loads a valid skill file with frontmatter and body', () => {
    writeFileSync(join(skillsDir, 'test-skill.md'), `---
name: Test Skill
output_schema:
  type: object
  required:
    - result
  properties:
    result:
      type: string
---

## Instructions

Do the thing.
`)
    const skill = loadSkill('test-skill', testDir)
    expect(skill).not.toBeNull()
    expect(skill!.name).toBe('Test Skill')
    expect(skill!.instructions).toContain('## Instructions\n\nDo the thing.')
    expect(skill!.instructions).toContain('SCOPE BOUNDARY')
    expect(skill!.output_schema).toBeDefined()
    expect((skill!.output_schema as Record<string, unknown>).type).toBe('object')
  })

  it('parses output_schema from frontmatter', () => {
    writeFileSync(join(skillsDir, 'schema-skill.md'), `---
name: Schema Skill
output_schema:
  type: object
  required:
    - caption
  properties:
    caption:
      type: string
      maxLength: 280
---

Write a caption.
`)
    const skill = loadSkill('schema-skill', testDir)
    expect(skill!.output_schema).toBeDefined()
    const schema = skill!.output_schema as { required: string[]; properties: Record<string, unknown> }
    expect(schema.required).toContain('caption')
  })

  it('returns markdown body as instructions', () => {
    writeFileSync(join(skillsDir, 'body-only.md'), `---
name: Body Only
---

# Step 1

Do this first.

# Step 2

Then do this.
`)
    const skill = loadSkill('body-only', testDir)
    expect(skill!.instructions).toContain('# Step 1')
    expect(skill!.instructions).toContain('# Step 2')
  })

  it('returns null for nonexistent skill file', () => {
    const skill = loadSkill('nonexistent', testDir)
    expect(skill).toBeNull()
  })

  it('handles skill file with no frontmatter', () => {
    writeFileSync(join(skillsDir, 'no-frontmatter.md'), 'Just instructions, no frontmatter.')

    const skill = loadSkill('no-frontmatter', testDir)
    expect(skill).not.toBeNull()
    expect(skill!.name).toBe('no-frontmatter')
    expect(skill!.instructions).toContain('Just instructions, no frontmatter.')
    expect(skill!.instructions).toContain('SCOPE BOUNDARY')
    expect(skill!.output_schema).toBeUndefined()
  })

  it('handles skill file with empty body', () => {
    writeFileSync(join(skillsDir, 'empty-body.md'), `---
name: Empty Body
output_schema:
  type: object
  properties:
    x:
      type: string
---
`)
    const skill = loadSkill('empty-body', testDir)
    expect(skill).not.toBeNull()
    expect(skill!.instructions).toContain('SCOPE BOUNDARY')
    expect(skill!.output_schema).toBeDefined()
  })
})

describe('skill-loader — multi-source precedence (user > agent-package > plugin)', () => {
  const testDir = join(tmpdir(), `bakin-test-skills-precedence-${Date.now()}`)
  const skillsDir = join(testDir, 'workflows', 'skills')

  beforeEach(() => {
    invalidateSkillCache()
    clearAgentPackageSkillRegistry()
    mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    invalidateSkillCache()
    clearAgentPackageSkillRegistry()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('agent-package skill resolves when no user file shadows it', () => {
    registerAgentPackageSkill('pixel', 'pkg-only', {
      name: 'Package Only',
      instructions: 'package body',
    })
    const skill = loadSkill('pkg-only', testDir)
    expect(skill).not.toBeNull()
    expect(skill!.name).toBe('Package Only')
    expect(skill!.instructions).toContain('package body')
    expect(skill!.instructions).toContain('SCOPE BOUNDARY')
  })

  it('user file wins over agent-package registration', () => {
    invalidateSkillCache()
    registerAgentPackageSkill('pixel', 'shared', {
      name: 'From Package',
      instructions: 'package body',
    })
    writeFileSync(
      join(skillsDir, 'shared.md'),
      `---\nname: From User\n---\n\nuser body`,
    )
    const skill = loadSkill('shared', testDir)
    expect(skill!.name).toBe('From User')
    expect(skill!.instructions).toContain('user body')
    expect(skill!.instructions).not.toContain('package body')
  })

  it('appends SCOPE BOUNDARY exactly once even when package skill already has it', () => {
    registerAgentPackageSkill('pixel', 'fenced', {
      name: 'Fenced',
      instructions: 'body\n\n---\n**SCOPE BOUNDARY:** already here',
    })
    const skill = loadSkill('fenced', testDir)
    const occurrences = (skill!.instructions.match(/SCOPE BOUNDARY/g) || []).length
    expect(occurrences).toBe(1)
  })

  it('listAllSkills surfaces source="agent-package" entries', () => {
    registerAgentPackageSkill('pixel', 'a', { name: 'A', instructions: 'a' })
    registerAgentPackageSkill('pixel', 'b', { name: 'B', instructions: 'b' })

    const all = listAllSkills(testDir)
    const byName = new Map(all.map((s) => [s.name, s]))
    expect(byName.get('a')?.source).toBe('agent-package')
    expect(byName.get('b')?.source).toBe('agent-package')
  })

  it('listAllSkills resolves user-shadowed package skills with source="user"', () => {
    registerAgentPackageSkill('pixel', 'shadowed', {
      name: 'shadowed',
      instructions: 'pkg',
    })
    writeFileSync(
      join(skillsDir, 'shadowed.md'),
      `---\nname: shadowed\n---\n\nuser`,
    )

    const all = listAllSkills(testDir)
    const found = all.find((s) => s.name === 'shadowed')
    expect(found?.source).toBe('user')
    // Only one entry — no duplicate from the agent-package tier
    expect(all.filter((s) => s.name === 'shadowed')).toHaveLength(1)
  })
})
