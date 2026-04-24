import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadSkill, invalidateSkillCache } from '@bakin/workflows/lib/skill-loader'

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
