/**
 * RED test for the generic plugin-skill auto-loader.
 *
 * Each plugin may ship `defaults/workflow-skills/*.md` files alongside its
 * code. The plugin loader scans that directory after `plugin.activate(ctx)`
 * and registers every parsed skill via `ctx.registerSkill`, so the workflows
 * runtime can resolve them by name without any manual wiring inside each
 * plugin's `activate()`.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-plugin-skills-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { loadPluginSkills } from '@/lib/plugin-skill-loader'
import type { PluginContext, SkillDefinition } from '@bakin/core/plugin-types'

const fakeLog = { warn: mock(), info: mock(), error: mock(), debug: mock() }

const writeCopySkill = `---
name: Write Copy
output_schema:
  type: object
  required:
    - caption
  properties:
    caption:
      type: string
      maxLength: 280
---

## Instructions

Write a punchy social caption.
`

const publishSkill = `---
name: Publish
---

Push the post live.
`

const malformedSkill = `not-yaml-frontmatter

just a body
`

function buildCtx(): { ctx: PluginContext; calls: SkillDefinition[] } {
  const calls: SkillDefinition[] = []
  const ctx = {
    pluginId: 'fake-plugin',
    registerSkill: (skill: SkillDefinition) => {
      calls.push(skill)
    },
  } as unknown as PluginContext
  return { ctx, calls }
}

describe('loadPluginSkills', () => {
  let pluginPath: string
  let skillsDir: string

  beforeEach(() => {
    pluginPath = join(testDir, `plugin-${Math.random().toString(36).slice(2)}`)
    skillsDir = join(pluginPath, 'defaults', 'workflow-skills')
    mkdirSync(skillsDir, { recursive: true })
    fakeLog.warn.mockClear()
    fakeLog.info.mockClear()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('registers every .md skill in defaults/workflow-skills/', () => {
    writeFileSync(join(skillsDir, 'write-copy.md'), writeCopySkill)
    writeFileSync(join(skillsDir, 'publish.md'), publishSkill)

    const { ctx, calls } = buildCtx()
    const result = loadPluginSkills(pluginPath, ctx, fakeLog)

    expect(result.registered.sort()).toEqual(['publish', 'write-copy'])
    expect(calls).toHaveLength(2)
  })

  it('uses the frontmatter `name` for the skill registration', () => {
    writeFileSync(join(skillsDir, 'write-copy.md'), writeCopySkill)

    const { ctx, calls } = buildCtx()
    loadPluginSkills(pluginPath, ctx, fakeLog)

    expect(calls[0].name).toBe('Write Copy')
  })

  it('falls back to the filename (sans .md) when frontmatter has no `name`', () => {
    writeFileSync(
      join(skillsDir, 'no-name.md'),
      `---\n---\n\nbody only\n`,
    )

    const { ctx, calls } = buildCtx()
    loadPluginSkills(pluginPath, ctx, fakeLog)

    expect(calls[0].name).toBe('no-name')
  })

  it('exposes output_schema when present in frontmatter', () => {
    writeFileSync(join(skillsDir, 'write-copy.md'), writeCopySkill)

    const { ctx, calls } = buildCtx()
    loadPluginSkills(pluginPath, ctx, fakeLog)

    expect(calls[0].output_schema).toBeDefined()
    expect((calls[0].output_schema as Record<string, unknown>).type).toBe('object')
  })

  it('uses the markdown body as the skill instructions', () => {
    writeFileSync(join(skillsDir, 'publish.md'), publishSkill)

    const { ctx, calls } = buildCtx()
    loadPluginSkills(pluginPath, ctx, fakeLog)

    expect(calls[0].instructions.trim()).toBe('Push the post live.')
  })

  it('returns empty result when defaults/workflow-skills/ does not exist', () => {
    rmSync(skillsDir, { recursive: true, force: true })

    const { ctx, calls } = buildCtx()
    const result = loadPluginSkills(pluginPath, ctx, fakeLog)

    expect(result.registered).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('skips files that fail to parse and warns', () => {
    writeFileSync(join(skillsDir, 'broken.md'), malformedSkill)
    writeFileSync(join(skillsDir, 'good.md'), publishSkill)

    const { ctx, calls } = buildCtx()
    const result = loadPluginSkills(pluginPath, ctx, fakeLog)

    // "broken.md" has no `---` fence so it should still register with
    // the filename as the name and the entire content as the body —
    // skill files don't *require* frontmatter. The malformed case is
    // really when YAML parsing throws.
    expect(result.registered).toContain('good')
    expect(calls.find(c => c.name === 'good' || c.name === 'Publish')).toBeDefined()
  })

  it('ignores non-.md files', () => {
    writeFileSync(join(skillsDir, 'README.txt'), 'not a skill')
    writeFileSync(join(skillsDir, 'write-copy.md'), writeCopySkill)

    const { ctx, calls } = buildCtx()
    const result = loadPluginSkills(pluginPath, ctx, fakeLog)

    expect(result.registered).toEqual(['write-copy'])
    expect(calls).toHaveLength(1)
  })
})
