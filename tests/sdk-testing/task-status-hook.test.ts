/**
 * The published harness fires `tasks.statusChanged` exactly like the host
 * (spec D21): once per real column change through ctx.tasks, after the write,
 * never for writes that keep the column. External-author style — only
 * `@makinbakin/sdk` imports.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { definePlugin } from '@makinbakin/sdk'
import type { PluginContext } from '@makinbakin/sdk/types'
import { activatePlugin } from '@makinbakin/sdk/testing'

const changes: Array<Record<string, unknown>> = []
let tasks: PluginContext['tasks'] | undefined

const plugin = definePlugin({
  id: 'watcher',
  name: 'watcher',
  version: '0.1.0',
  activate: (ctx) => {
    tasks = ctx.tasks
    ctx.hooks.register('tasks.statusChanged', (data: unknown) => {
      changes.push(data as Record<string, unknown>)
    })
  },
})

const harness = await activatePlugin(plugin)
afterAll(() => harness.dispose())

/** Poll until `count` events arrived (handlers run after the write), up to 1s. */
async function eventsArrived(count: number): Promise<void> {
  for (let i = 0; i < 100 && changes.length < count; i++) await new Promise<void>((resolve) => setTimeout(resolve, 10))
}

describe('tasks.statusChanged in the SDK harness', () => {
  it('fires once per column change through move and update, and not for other writes', async () => {
    const task = await tasks!.create({ title: 'Ship it', column: 'todo' })
    await tasks!.update(task.id, { title: 'Ship it now' })
    await tasks!.move(task.id, 'review')
    await tasks!.update(task.id, { column: 'done' })
    await eventsArrived(2)
    expect(changes.map((c) => [c.taskId, c.from, c.to])).toEqual([
      [task.id, 'todo', 'review'],
      [task.id, 'review', 'done'],
    ])
  })

  it('the public `checked` patch completes and reopens a task, firing the hook like the host', async () => {
    changes.length = 0
    const task = await tasks!.create({ title: 'Check me', column: 'todo' })
    await tasks!.update(task.id, { checked: true })
    await tasks!.update(task.id, { checked: false })
    await eventsArrived(2)
    expect(changes.map((c) => [c.from, c.to])).toEqual([['todo', 'done'], ['done', 'todo']])
  })
})
