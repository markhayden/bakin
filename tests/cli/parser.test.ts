import { describe, expect, it } from 'bun:test'

import { parseCliInvocation } from '../../src/core/cli/parser'

describe('parseCliInvocation', () => {
  it('defaults no-arg invocation to help', () => {
    expect(parseCliInvocation(['node', 'bakin'])).toMatchObject({
      commandName: 'help',
      commandArgs: [],
      commandFound: true,
    })
  })

  it('matches multi-word built-in commands by longest literal prefix', () => {
    expect(parseCliInvocation(['node', 'bakin', 'tasks', 'list', '--column=todo'])).toMatchObject({
      commandName: 'tasks list',
      commandArgs: ['--column=todo'],
      commandFound: true,
    })
  })

  it('matches command aliases', () => {
    expect(parseCliInvocation(['node', 'bakin', 'reboot'])).toMatchObject({
      commandName: 'restart',
      commandArgs: [],
      commandFound: true,
    })
  })

  it('normalizes global help and version flags', () => {
    expect(parseCliInvocation(['node', 'bakin', '--help'])).toMatchObject({
      commandName: 'help',
      commandFound: true,
    })
    expect(parseCliInvocation(['node', 'bakin', '-v'])).toMatchObject({
      commandName: 'version',
      commandFound: true,
    })
  })

  it('keeps raw payloads after end-of-options marker', () => {
    expect(parseCliInvocation([
      'node',
      'bakin',
      'workflows',
      'submit',
      'task-1',
      'step-1',
      '--',
      '{"flag":"--json"}',
    ])).toMatchObject({
      commandName: 'workflows submit',
      commandArgs: ['task-1', 'step-1', '{"flag":"--json"}'],
      commandFound: true,
      passthrough: ['{"flag":"--json"}'],
      endOfOptions: true,
    })
  })

  it('marks unknown commands without losing args', () => {
    expect(parseCliInvocation(['node', 'bakin', 'wat', 'now'])).toMatchObject({
      commandName: 'wat',
      commandArgs: ['now'],
      commandFound: false,
    })
  })
})
