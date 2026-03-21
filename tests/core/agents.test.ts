import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getAgentTasks } from '@/core/agents'

describe('agents', () => {
  let tempDir: string
  let contentDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'beacon-agents-test-'))
    contentDir = tempDir
    mkdirSync(join(contentDir, 'heartbeats'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('getAgentTasks', () => {
    it('should return empty array when no taskboard exists', () => {
      expect(getAgentTasks('main-operator', contentDir)).toEqual([])
    })

    it('should parse tasks assigned to a specific agent', () => {
      writeFileSync(join(contentDir, 'TASKBOARD.md'), `# Taskboard

## 🔵 In Progress

- [ ] Fix the bug @main-operator <!-- id:fix-bug -->
- [ ] Design logo @pixel <!-- id:design-logo -->

## 📋 TODO

- [ ] Write docs @main-operator <!-- id:write-docs -->
`)

      const tasks = getAgentTasks('main-operator', contentDir)
      expect(tasks).toHaveLength(2)
      expect(tasks[0].id).toBe('fix-bug')
      expect(tasks[0].column).toBe('in-progress')
      expect(tasks[1].id).toBe('write-docs')
      expect(tasks[1].column).toBe('todo')
    })

    it('should not return tasks assigned to other agents', () => {
      writeFileSync(join(contentDir, 'TASKBOARD.md'), `# Taskboard

## 🔵 In Progress

- [ ] Design logo @pixel <!-- id:design-logo -->
`)

      const tasks = getAgentTasks('main-operator', contentDir)
      expect(tasks).toHaveLength(0)
    })
  })
})
