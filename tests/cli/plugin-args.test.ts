import { describe, expect, it } from 'bun:test'

import { matchCliCommand } from '../../src/cli/plugin-args'
import type { CliCommandContribution } from '../../packages/sdk/src/types/manifest'

const toggle: CliCommandContribution = {
  name: 'projects:toggle-item',
  usage: 'bakin projects toggle-item <projectId> <itemId> <checked>',
  summary: 'Toggle a checklist item',
  dispatch: { type: 'execTool', name: 'bakin_exec_projects_toggle_item' },
  args: [
    { name: 'projectId', type: 'string', positional: true, required: true },
    { name: 'itemId', type: 'string', positional: true, required: true },
    { name: 'checked', type: 'boolean', positional: true, required: true },
  ],
}

const create: CliCommandContribution = {
  name: 'projects:create',
  usage: 'bakin projects create <title>',
  summary: 'Create a project',
  dispatch: { type: 'execTool', name: 'bakin_exec_projects_create' },
  args: [
    { name: 'title', type: 'string', positional: true, required: true },
    { name: 'tasks', type: 'string[]' },
    { name: 'priority', type: 'number' },
    { name: 'status', type: 'string', values: ['draft', 'active'] },
    { name: 'pinned', type: 'boolean' },
  ],
}

const list: CliCommandContribution = {
  name: 'projects:list',
  usage: 'bakin projects list',
  summary: 'List projects',
  dispatch: { type: 'execTool', name: 'bakin_exec_projects_list' },
  args: [],
}

describe('matchCliCommand', () => {
  it('returns null when the literal command words do not match', () => {
    expect(matchCliCommand(list, ['projects', 'get'])).toBeNull()
    expect(matchCliCommand(list, ['messaging', 'list'])).toBeNull()
  })

  it('maps positionals by declaration order and parses a boolean positional', () => {
    expect(matchCliCommand(toggle, ['projects', 'toggle-item', 'p1', 'i1', 'false'])).toEqual({
      ok: true, params: { projectId: 'p1', itemId: 'i1', checked: false },
    })
  })

  it('keeps string values literal — commas, JSON and "true" are not coerced', () => {
    expect(matchCliCommand(create, ['projects', 'create', 'a,b'])).toEqual({ ok: true, params: { title: 'a,b' } })
    expect(matchCliCommand(create, ['projects', 'create', '[1]'])).toEqual({ ok: true, params: { title: '[1]' } })
    expect(matchCliCommand(create, ['projects', 'create', 'true'])).toEqual({ ok: true, params: { title: 'true' } })
  })

  it('collects a repeated string[] flag in order', () => {
    expect(matchCliCommand(create, ['projects', 'create', 'T', '--tasks', 'one', '--tasks=two, three'])).toEqual({
      ok: true, params: { title: 'T', tasks: ['one', 'two, three'] },
    })
  })

  it('parses numbers, enums and bare boolean flags', () => {
    expect(matchCliCommand(create, ['projects', 'create', 'T', '--priority', '2', '--status=active', '--pinned'])).toEqual({
      ok: true, params: { title: 'T', priority: 2, status: 'active', pinned: true },
    })
    expect(matchCliCommand(create, ['projects', 'create', 'T', '--pinned=false'])).toEqual({
      ok: true, params: { title: 'T', pinned: false },
    })
  })

  it('rejects unknown flags, surplus positionals and missing required args', () => {
    expect(matchCliCommand(create, ['projects', 'create', 'T', '--nope', 'x'])).toEqual({ ok: false, error: 'Unknown option --nope' })
    expect(matchCliCommand(create, ['projects', 'create', 'T', 'extra'])).toEqual({ ok: false, error: 'Unexpected argument "extra"' })
    expect(matchCliCommand(toggle, ['projects', 'toggle-item', 'p1'])).toEqual({ ok: false, error: 'Missing required argument <itemId>' })
  })

  it('rejects malformed typed values instead of passing strings through', () => {
    expect(matchCliCommand(create, ['projects', 'create', 'T', '--priority', 'high'])).toEqual({ ok: false, error: '--priority must be a number' })
    expect(matchCliCommand(create, ['projects', 'create', 'T', '--status', 'gone'])).toEqual({ ok: false, error: '--status must be one of: draft, active' })
    expect(matchCliCommand(toggle, ['projects', 'toggle-item', 'p1', 'i1', 'yes'])).toEqual({ ok: false, error: '<checked> must be true or false' })
    expect(matchCliCommand(create, ['projects', 'create', 'T', '--priority'])).toEqual({ ok: false, error: '--priority needs a value' })
  })

  it('rejects a non-repeatable flag given twice', () => {
    expect(matchCliCommand(create, ['projects', 'create', 'T', '--priority', '1', '--priority', '2'])).toEqual({ ok: false, error: '--priority was given more than once' })
  })
})
