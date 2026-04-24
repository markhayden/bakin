import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock flow-store to avoid touching real SQLite
const mockTasks: Array<{ id: string; title: string; agent?: string; description?: string }> = []
const mockColumns: Record<string, typeof mockTasks> = {
  backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [],
}

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@bakin/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: mockColumns }),
}))

import { getAgentTasks } from '@/core/agents'

describe('agents', () => {
  let tempDir: string
  let contentDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-agents-test-'))
    contentDir = tempDir
    mkdirSync(join(contentDir, 'heartbeats'), { recursive: true })

    // Reset mock columns
    for (const key of Object.keys(mockColumns)) {
      mockColumns[key] = []
    }
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('getAgentTasks', () => {
    it('should return empty array when no tasks exist', () => {
      expect(getAgentTasks('main', contentDir)).toEqual([])
    })

    it('should return tasks assigned to a specific agent', () => {
      mockColumns.inProgress = [
        { id: 'fix-bug', title: 'Fix the bug', agent: 'main' },
        { id: 'design-logo', title: 'Design logo', agent: 'pixel' },
      ]
      mockColumns.todo = [
        { id: 'write-docs', title: 'Write docs', agent: 'main' },
      ]

      const tasks = getAgentTasks('main', contentDir)
      expect(tasks).toHaveLength(2)
      expect(tasks[0].id).toBe('fix-bug')
      expect(tasks[0].column).toBe('in-progress')
      expect(tasks[1].id).toBe('write-docs')
      expect(tasks[1].column).toBe('todo')
    })

    it('should not return tasks assigned to other agents', () => {
      mockColumns.inProgress = [
        { id: 'design-logo', title: 'Design logo', agent: 'pixel' },
      ]

      const tasks = getAgentTasks('main', contentDir)
      expect(tasks).toHaveLength(0)
    })
  })
})
