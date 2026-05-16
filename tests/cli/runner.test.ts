import { describe, expect, it } from 'bun:test'

import { createCliRunner } from '../../src/core/cli/runner'
import { okResult, toEnvelope } from '../../src/core/cli/result'

describe('createCliRunner', () => {
  it('runs a registered command with parsed invocation context', async () => {
    const runner = createCliRunner()
    runner.register('tasks list', parsed => okResult('tasks list', { args: parsed.commandArgs, json: parsed.global.json }))

    const result = await runner.run(['node', 'bakin', '--json', 'tasks', 'list', '--column=todo'])

    expect(toEnvelope(result)).toEqual({
      ok: true,
      command: 'tasks list',
      exitCode: 0,
      data: { args: ['--column=todo'], json: true },
      error: null,
    })
  })

  it('returns structured unknown-command errors', async () => {
    const runner = createCliRunner()

    expect(toEnvelope(await runner.run(['node', 'bakin', 'wat']))).toMatchObject({
      ok: false,
      command: 'wat',
      exitCode: 1,
      error: {
        code: 'UNKNOWN_COMMAND',
        message: 'Unknown command: wat',
      },
    })
  })

  it('distinguishes known but unregistered commands during migration', async () => {
    const runner = createCliRunner()

    expect(toEnvelope(await runner.run(['node', 'bakin', 'doctor']))).toMatchObject({
      ok: false,
      command: 'doctor',
      exitCode: 1,
      error: {
        code: 'COMMAND_NOT_IMPLEMENTED',
      },
    })
  })
})
