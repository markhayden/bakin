/**
 * Workflow health checks — migration regression coverage.
 *
 * Asserts that the three functions moved out of src/core/doctor.ts
 * (#137) continue to produce `HealthCheckResult[]` rows with the same
 * shape and semantics as they did pre-migration. Exercises each check
 * against fixture workflow data written to a temp directory.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-workflow-health-${Date.now()}`)
})()

// ES imports are hoisted above mock.module — set env so the content-dir
// guard doesn't trip when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => `${testDir}/.openclaw`,
  getOpenClawPath: (p: string = '') => `${testDir}/.openclaw/${p}`,
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { autoFixSkill: false } }),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))
mock.module('../../../src/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [{ id: 'task-exists' }], inProgress: [], review: [], done: [], archived: [], blocked: [], backlog: [] } }),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: () => ({ columns: { todo: [{ id: 'task-exists' }], inProgress: [], review: [], done: [], archived: [], blocked: [], backlog: [] } }),
}))

// Hook registry remains available for plugin activation paths.
mock.module('../../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: async (_name: string) => {
      return undefined
    },
    has: () => false,
    register: () => () => {},
  }),
}))

import {
  checkWorkflowSkills,
  checkWorkflowDefinitions,
  checkStaleWorkflowInstances,
} from '../../../plugins/workflows/lib/health-checks'

const skillsDir = join(testDir, 'workflows', 'skills')
const definitionsDir = join(testDir, 'workflows', 'definitions')
const instancesDir = join(testDir, 'workflows', 'instances')

beforeAll(() => {
  mkdirSync(skillsDir, { recursive: true })
  mkdirSync(definitionsDir, { recursive: true })
  mkdirSync(instancesDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Clear dirs between tests
  for (const dir of [skillsDir, definitionsDir, instancesDir]) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }
})

describe('checkWorkflowSkills', () => {
  it('returns an ok result when the skills directory is empty', () => {
    const results = checkWorkflowSkills(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
  })

  it('flags a skill missing YAML frontmatter', () => {
    writeFileSync(join(skillsDir, 'bad.md'), 'just some content, no frontmatter')
    const results = checkWorkflowSkills(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('no YAML frontmatter'))).toBe(true)
  })

  it('flags a skill missing output_schema', () => {
    writeFileSync(
      join(skillsDir, 'no-schema.md'),
      '---\nname: no-schema\ndescription: test\n---\nbody',
    )
    const results = checkWorkflowSkills(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('no output_schema'))).toBe(true)
  })

  it('returns ok when all skills have output_schema', () => {
    writeFileSync(
      join(skillsDir, 'good.md'),
      '---\nname: good\noutput_schema: { foo: string }\n---\nbody',
    )
    const results = checkWorkflowSkills(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
  })
})

describe('checkWorkflowDefinitions', () => {
  it('returns ok when no definitions exist', async () => {
    const results = await checkWorkflowDefinitions(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/All workflow skill references resolve/)
  })

  it('flags a workflow step referencing a missing skill', async () => {
    // Create the skill referenced by one workflow, not the other
    writeFileSync(join(skillsDir, 'existing-skill.md'), '---\nname: existing\n---\nbody')
    writeFileSync(
      join(definitionsDir, 'broken-flow.yaml'),
      `name: Broken flow
description: test
version: 1
steps:
  - id: s1
    label: Step 1
    type: agent
    agent: main
    skill: missing-skill
`,
    )
    const results = await checkWorkflowDefinitions(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('missing-skill'))).toBe(true)
  })
})

describe('checkStaleWorkflowInstances', () => {
  it('returns ok when no instances exist', async () => {
    const results = await checkStaleWorkflowInstances(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/No stale workflow instances/)
  })

  it('flags an orphaned instance (task no longer on board)', async () => {
    const orphanedId = 'task-deleted'
    writeFileSync(
      join(instancesDir, `${orphanedId}.json`),
      JSON.stringify({
        instanceId: 'i1',
        taskId: orphanedId,
        status: 'in_progress',
        currentStepId: 's1',
        updatedAt: new Date().toISOString(),
      }),
    )
    const results = await checkStaleWorkflowInstances(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes(orphanedId))).toBe(true)
  })

  it('flags a stale in-progress instance (>2h old)', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    writeFileSync(
      join(instancesDir, 'task-exists.json'),
      JSON.stringify({
        instanceId: 'i2',
        taskId: 'task-exists',
        status: 'in_progress',
        currentStepId: 'waiting-step',
        updatedAt: threeHoursAgo,
      }),
    )
    const results = await checkStaleWorkflowInstances(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('in_progress'))).toBe(true)
  })
})
