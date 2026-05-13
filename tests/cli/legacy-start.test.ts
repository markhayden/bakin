import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'

let spawnCalled = false

mock.module('child_process', () => ({
  spawn: () => {
    spawnCalled = true
    throw new Error('legacy start must not spawn')
  },
  execSync: () => '',
}))

describe('legacy CLI start command', () => {
  const originalArgv = process.argv
  const originalExit = process.exit

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    spawnCalled = false
  })

  it('does not exist, preventing the old detached npx tsx server path from running', async () => {
    const err = spyOn(console, 'error').mockImplementation(() => {})
    const log = spyOn(console, 'log').mockImplementation(() => {})
    process.argv = ['bun', 'cli/bakin.ts', 'start']
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(spawnCalled).toBe(false)
    const output = err.mock.calls.map(call => String(call[0])).join('\n')
    expect(output).toContain('Unknown command: start')
    const usage = log.mock.calls.map(call => String(call[0])).join('\n')
    expect(usage).not.toContain('bakin start')
    log.mockRestore()
    err.mockRestore()
  })
})
