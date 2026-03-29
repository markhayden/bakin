import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `beacon-test-projects-parser-${Date.now()}`)
const projectsDir = join(testDir, 'projects')

vi.mock('../../../src/core/content-dir', () => ({
  getBeaconPaths: () => ({ projects: projectsDir }),
  getContentDir: () => testDir,
}))

import {
  parseProject,
  serializeProject,
  computeProgress,
  nextTaskItemId,
  readProject,
  readAllProjects,
  writeProject,
  deleteProjectFile,
  projectToSummary,
} from '../../../plugins/projects/lib/parser'
import type { Project, ProjectTask } from '../../../plugins/projects/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_PROJECT = `---
id: abc12345
title: "Test Project"
status: active
created: "2026-03-28T10:00:00.000Z"
updated: "2026-03-28T12:00:00.000Z"
owner: roscoe
tasks:
  - id: t001
    title: "First task"
    checked: true
  - id: t002
    title: "Second task"
    taskId: def67890
    checked: false
  - id: t003
    title: "Third task"
    description: "Some details"
    checked: false
assets:
  - path: images/logo.png
    label: "Logo"
  - path: docs/spec.pdf
---

# Test Project

## Goal
Build something great.
`

const MINIMAL_PROJECT = `---
id: min00001
title: "Minimal"
status: draft
created: "2026-03-28T10:00:00.000Z"
updated: "2026-03-28T10:00:00.000Z"
owner: roscoe
tasks: []
---

Empty project.
`

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mkdirSync(projectsDir, { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// computeProgress
// ---------------------------------------------------------------------------

describe('computeProgress', () => {
  it('returns 0 for empty tasks', () => {
    expect(computeProgress([])).toBe(0)
  })

  it('returns 100 when all checked', () => {
    const tasks: ProjectTask[] = [
      { id: 't001', title: 'a', checked: true },
      { id: 't002', title: 'b', checked: true },
    ]
    expect(computeProgress(tasks)).toBe(100)
  })

  it('returns correct percentage', () => {
    const tasks: ProjectTask[] = [
      { id: 't001', title: 'a', checked: true },
      { id: 't002', title: 'b', checked: false },
      { id: 't003', title: 'c', checked: false },
    ]
    expect(computeProgress(tasks)).toBe(33)
  })
})

// ---------------------------------------------------------------------------
// nextTaskItemId
// ---------------------------------------------------------------------------

describe('nextTaskItemId', () => {
  it('returns t001 for empty list', () => {
    expect(nextTaskItemId([])).toBe('t001')
  })

  it('increments from highest existing', () => {
    const tasks: ProjectTask[] = [
      { id: 't003', title: 'a', checked: false },
      { id: 't001', title: 'b', checked: false },
    ]
    expect(nextTaskItemId(tasks)).toBe('t004')
  })
})

// ---------------------------------------------------------------------------
// parseProject
// ---------------------------------------------------------------------------

describe('parseProject', () => {
  it('parses frontmatter and body', () => {
    const project = parseProject(SAMPLE_PROJECT)
    expect(project.id).toBe('abc12345')
    expect(project.title).toBe('Test Project')
    expect(project.status).toBe('active')
    expect(project.owner).toBe('roscoe')
    expect(project.body).toContain('# Test Project')
    expect(project.body).toContain('Build something great.')
  })

  it('parses tasks with all fields', () => {
    const project = parseProject(SAMPLE_PROJECT)
    expect(project.tasks).toHaveLength(3)
    expect(project.tasks[0]).toEqual({ id: 't001', title: 'First task', checked: true, description: undefined, taskId: undefined })
    expect(project.tasks[1].taskId).toBe('def67890')
    expect(project.tasks[2].description).toBe('Some details')
  })

  it('computes progress from tasks', () => {
    const project = parseProject(SAMPLE_PROJECT)
    expect(project.progress).toBe(33) // 1 of 3 checked
  })

  it('parses assets', () => {
    const project = parseProject(SAMPLE_PROJECT)
    expect(project.assets).toHaveLength(2)
    expect(project.assets[0]).toEqual({ path: 'images/logo.png', label: 'Logo' })
    expect(project.assets[1]).toEqual({ path: 'docs/spec.pdf', label: undefined })
  })

  it('handles missing tasks and assets', () => {
    const project = parseProject(MINIMAL_PROJECT)
    expect(project.tasks).toHaveLength(0)
    expect(project.assets).toHaveLength(0)
    expect(project.progress).toBe(0)
  })

  it('throws on missing frontmatter', () => {
    expect(() => parseProject('No frontmatter here')).toThrow('missing YAML frontmatter')
  })

  it('defaults invalid status to draft', () => {
    const content = SAMPLE_PROJECT.replace('status: active', 'status: bogus')
    const project = parseProject(content)
    expect(project.status).toBe('draft')
  })
})

// ---------------------------------------------------------------------------
// serializeProject
// ---------------------------------------------------------------------------

describe('serializeProject', () => {
  it('round-trips a project', () => {
    const original = parseProject(SAMPLE_PROJECT)
    const serialized = serializeProject(original)
    const reparsed = parseProject(serialized)

    expect(reparsed.id).toBe(original.id)
    expect(reparsed.title).toBe(original.title)
    expect(reparsed.status).toBe(original.status)
    expect(reparsed.tasks).toEqual(original.tasks)
    expect(reparsed.assets).toEqual(original.assets)
    expect(reparsed.body).toContain('Build something great.')
  })

  it('omits empty assets array', () => {
    const project = parseProject(MINIMAL_PROJECT)
    const serialized = serializeProject(project)
    expect(serialized).not.toContain('assets:')
  })

  it('omits undefined taskId and description', () => {
    const project = parseProject(MINIMAL_PROJECT)
    project.tasks = [{ id: 't001', title: 'Test', checked: false }]
    const serialized = serializeProject(project)
    expect(serialized).not.toContain('taskId')
    expect(serialized).not.toContain('description')
  })

  it('includes taskId and description when present', () => {
    const project = parseProject(SAMPLE_PROJECT)
    const serialized = serializeProject(project)
    expect(serialized).toContain('taskId: def67890')
    expect(serialized).toContain('description: Some details')
  })
})

// ---------------------------------------------------------------------------
// File I/O: readProject, writeProject, readAllProjects, deleteProjectFile
// ---------------------------------------------------------------------------

describe('File I/O', () => {
  it('writeProject and readProject round-trip', () => {
    const project = parseProject(SAMPLE_PROJECT)
    writeProject(project)

    const read = readProject('abc12345')
    expect(read).not.toBeNull()
    expect(read!.title).toBe('Test Project')
    expect(read!.tasks).toHaveLength(3)
  })

  it('readProject returns null for missing id', () => {
    expect(readProject('nonexistent')).toBeNull()
  })

  it('readAllProjects reads all .md files', () => {
    const p1 = parseProject(SAMPLE_PROJECT)
    const p2 = parseProject(MINIMAL_PROJECT)
    writeProject(p1)
    writeProject(p2)

    const all = readAllProjects()
    expect(all).toHaveLength(2)
    const ids = all.map(p => p.id).sort()
    expect(ids).toEqual(['abc12345', 'min00001'])
  })

  it('readAllProjects skips malformed files', () => {
    writeFileSync(join(projectsDir, 'bad.md'), 'not valid yaml frontmatter', 'utf-8')
    const p1 = parseProject(SAMPLE_PROJECT)
    writeProject(p1)

    const all = readAllProjects()
    expect(all).toHaveLength(1)
  })

  it('deleteProjectFile removes the file', () => {
    const project = parseProject(SAMPLE_PROJECT)
    writeProject(project)
    expect(existsSync(join(projectsDir, 'abc12345.md'))).toBe(true)

    const result = deleteProjectFile('abc12345')
    expect(result).toBe(true)
    expect(existsSync(join(projectsDir, 'abc12345.md'))).toBe(false)
  })

  it('deleteProjectFile returns false for missing file', () => {
    expect(deleteProjectFile('nonexistent')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// projectToSummary
// ---------------------------------------------------------------------------

describe('projectToSummary', () => {
  it('produces correct summary', () => {
    const project = parseProject(SAMPLE_PROJECT)
    const summary = projectToSummary(project)

    expect(summary.id).toBe('abc12345')
    expect(summary.title).toBe('Test Project')
    expect(summary.status).toBe('active')
    expect(summary.owner).toBe('roscoe')
    expect(summary.progress).toBe(33)
    expect(summary.taskCount).toBe(3)
    expect(summary.assetCount).toBe(2)
    expect(summary.updated).toBe('2026-03-28T12:00:00.000Z')
  })
})
