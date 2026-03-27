import { describe, it, expect } from 'vitest'
import { parseTasks } from '../../../plugins/tasks/parser'

const SAMPLE_TASKBOARD = `# TASKBOARD

_Last updated: 03/20/2026, 14:30 MDT_

## 🔵 In Progress

- [ ] [abc12345] Build dashboard @patch — 03/19/2026
  Build the main dashboard component
  [2026-03-19 14:00 patch] Started working on layout
  [2026-03-19 15:30 patch] Header component done

## 📋 Todo

- [ ] [def67890] Write tests @roscoe
  Need unit tests for parser
- [ ] Create documentation
  No agent assigned

## 🔍 Review

- [ ] [ccc33333] Review script @pixel — 03/20/2026
  Awaiting gate approval

## ✅ Done

- [x] [aaa11111] Setup project @patch — 03/18/2026

## 🟣 Confirmed

## 🔴 Blocked

- [ ] [bbb22222] Deploy to prod @basil — BLOCKED: Waiting for API keys
`

describe('Task Parser', () => {
  it('parses all columns correctly', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)

    expect(board.columns.inProgress).toHaveLength(1)
    expect(board.columns.todo).toHaveLength(2)
    expect(board.columns.review).toHaveLength(1)
    expect(board.columns.done).toHaveLength(1)
    expect(board.columns.confirmed).toHaveLength(0)
    expect(board.columns.blocked).toHaveLength(1)
  })

  it('extracts task IDs', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)
    expect(board.columns.inProgress[0].id).toBe('abc12345')
    expect(board.columns.todo[0].id).toBe('def67890')
  })

  it('extracts agent assignments', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)
    expect(board.columns.inProgress[0].agent).toBe('patch')
    expect(board.columns.todo[1].agent).toBeUndefined()
  })

  it('parses log entries', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)
    const task = board.columns.inProgress[0]
    expect(task.log).toHaveLength(2)
    expect(task.log![0].author).toBe('patch')
    expect(task.log![0].message).toBe('Started working on layout')
    expect(task.log![1].timestamp).toBe('2026-03-19 15:30')
  })

  it('parses descriptions', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)
    expect(board.columns.inProgress[0].description).toBe('Build the main dashboard component')
    expect(board.columns.todo[0].description).toBe('Need unit tests for parser')
  })

  it('parses blocked reasons', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)
    const blocked = board.columns.blocked[0]
    expect(blocked.blockedReason).toBe('Waiting for API keys')
  })

  it('parses timestamp', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)
    expect(board.timestamp).toBe('03/20/2026, 14:30 MDT')
  })

  it('generates IDs for tasks without them', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)
    // "Create documentation" has no ID
    const noIdTask = board.columns.todo[1]
    expect(noIdTask.id).toBeDefined()
    expect(noIdTask.id.length).toBe(8)
  })

  it('parses review column', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)
    const task = board.columns.review[0]
    expect(task.id).toBe('ccc33333')
    expect(task.title).toBe('Review script')
    expect(task.agent).toBe('pixel')
    expect(task.description).toBe('Awaiting gate approval')
  })

  it('handles empty taskboard', () => {
    const board = parseTasks('# TASKBOARD\n\n## 📋 Todo\n\n## ✅ Done\n')
    expect(board.columns.todo).toHaveLength(0)
    expect(board.columns.done).toHaveLength(0)
  })

  it('handles checked tasks', () => {
    const board = parseTasks(SAMPLE_TASKBOARD)
    expect(board.columns.done[0].checked).toBe(true)
    expect(board.columns.inProgress[0].checked).toBe(false)
  })
})

describe('Task Parser - dependsOn', () => {
  it('parses dependency references', () => {
    const md = `# TASKBOARD

## 📋 Todo

- [ ] [aaaa1111] Task A @patch
  dependsOn: bbbb2222
`
    const board = parseTasks(md)
    expect(board.columns.todo[0].dependsOn).toBe('bbbb2222')
  })
})
