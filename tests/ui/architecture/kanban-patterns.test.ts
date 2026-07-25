import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('canonical kanban composition', () => {
  it('publishes one presentation-only board and lane implementation', () => {
    const path = 'packages/ui/src/patterns/kanban.tsx'
    expect(existsSync(resolve(ROOT, path))).toBe(true)
    const source = read(path)
    expect(source).not.toMatch(/@\/|@makinbakin\/sdk|@dnd-kit|useState|useEffect|window\.|document\./)
    expect(source).not.toMatch(/(?:bg|text|border)-(?:red|yellow|green|blue|gray|zinc|slate)-/)
    expect(read('packages/sdk/src/patterns/index.ts')).toContain('KanbanBoard')
  })

  it('documents low-chrome lanes, bounded overflow, bounded task cards, and precise drag feedback', () => {
    const storyPath = 'storybook/public/patterns/kanban.stories.tsx'
    expect(existsSync(resolve(ROOT, storyPath))).toBe(true)
    const story = read(storyPath)
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    expect(story).toContain("title: 'Patterns/Kanban board'")
    expect(story).toContain('StatusBadge')
    expect(story).toContain('Card')
    expect(story).toContain('DragAndDropFeedback')
    expect(story).toContain('data-drag-insertion-preview')
    expect(story).toContain('Whole-lane highlighting')
    expect(guide).toContain('Kanban lanes are low-chrome structure')
    expect(guide).toContain('BoundedOverflow')
    expect(guide).toContain('exact in-flow insertion position')
    expect(guide).toContain('stable scroll, lane, and keyed sortable wrappers')
  })
})
