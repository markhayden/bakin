import { afterEach, describe, expect, it } from 'bun:test'

import { commandArgsWithPassthrough, parseGlobalOptions } from '../../src/core/cli/options'

describe('CLI global options', () => {
  const originalNoColor = process.env.NO_COLOR
  const originalBakinNoColor = process.env.BAKIN_NO_COLOR

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = originalNoColor
    if (originalBakinNoColor === undefined) delete process.env.BAKIN_NO_COLOR
    else process.env.BAKIN_NO_COLOR = originalBakinNoColor
  })

  it('extracts global options without dropping command args', () => {
    const parsed = parseGlobalOptions(['--json', 'tasks', 'list', '--column=todo'])

    expect(parsed.options.json).toBe(true)
    expect(parsed.args).toEqual(['tasks', 'list', '--column=todo'])
    expect(commandArgsWithPassthrough(parsed)).toEqual(['tasks', 'list', '--column=todo'])
  })

  it('preserves raw payload after end-of-options marker', () => {
    const parsed = parseGlobalOptions(['workflows', 'submit', 'task-1', 'step-1', '--', '{"ok":true,"flag":"--json"}'])

    expect(parsed.options.json).toBe(false)
    expect(parsed.args).toEqual(['workflows', 'submit', 'task-1', 'step-1'])
    expect(parsed.passthrough).toEqual(['{"ok":true,"flag":"--json"}'])
    expect(commandArgsWithPassthrough(parsed)).toEqual([
      'workflows',
      'submit',
      'task-1',
      'step-1',
      '{"ok":true,"flag":"--json"}',
    ])
  })

  it('parses automation and display flags consistently', () => {
    const parsed = parseGlobalOptions(['--yes', '--force', '--verbose', '--no-color', 'plugins', 'import', 'plugins.json'])

    expect(parsed.options).toEqual({
      json: false,
      verbose: true,
      color: false,
      help: false,
      version: false,
      yes: true,
      force: true,
    })
    expect(parsed.args).toEqual(['plugins', 'import', 'plugins.json'])
  })

  it('honors no-color environment by default', () => {
    process.env.NO_COLOR = '1'
    delete process.env.BAKIN_NO_COLOR

    expect(parseGlobalOptions(['status']).options.color).toBe(false)
  })
})
