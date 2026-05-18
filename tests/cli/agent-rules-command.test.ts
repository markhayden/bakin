import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

const applyManagedBlocksMock = mock(async () => {
  const { createLogger } = await import('../../packages/core/src/logger')
  createLogger('settings').info('Settings loaded')
  return [
    { check: 'managed-context', status: 'ok', message: 'Managed context is current', autoFixable: false },
    { check: 'subagent-context', status: 'fixed', message: 'Updated stale context', autoFixable: true },
  ]
})

mock.module('../../src/core/agent-rules/managed-blocks', () => ({
  applyManagedBlocks: applyManagedBlocksMock,
}))

describe('agent-rules CLI TTY output', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>

  function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
  }

  function output(): string {
    return log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  beforeEach(() => {
    mock.clearAllMocks()
    applyManagedBlocksMock.mockResolvedValue([
      { check: 'managed-context', status: 'ok', message: 'Managed context is current', autoFixable: false },
      { check: 'subagent-context', status: 'fixed', message: 'Updated stale context', autoFixable: true },
    ])
    process.argv = originalArgv
    log = spyOn(console, 'log').mockImplementation(() => {})
    process.exit = ((code?: number) => {
      if (code === 0) return undefined as never
      throw new Error(`exit:${code}`)
    }) as never
    setStdoutIsTTY(true)
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    log.mockRestore()
  })

  it('renders agent-rules results with the shared TUI in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    process.argv = ['bun', 'cli/bakin.ts', 'agent-rules', '--apply']
    await main()

    expect(applyManagedBlocksMock).toHaveBeenCalledWith(true, { scope: 'orchestrator' })
    expect(output()).toContain('Agent Rules')
    expect(output()).toContain('scope: orchestrator')
    expect(output()).toContain('CHECKS')
    expect(output()).toContain('managed-context')
    expect(output()).toContain('Updated stale context')
    expect(output()).not.toContain('Settings loaded')
    expect(output()).not.toContain('[OK] managed-context')
  })
})
