import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { promisify } from 'util'

const execFileAsyncMock = mock(async () => ({
  stdout: JSON.stringify({
    models: [
      { key: 'configured/model', name: 'Configured Model', available: true },
      { key: 'unavailable/model', name: 'Unavailable Model', available: false },
    ],
  }),
  stderr: '',
}))

const execFileMock = mock(() => null)
;(execFileMock as unknown as Record<symbol, unknown>)[promisify.custom] = execFileAsyncMock

mock.module('child_process', () => ({
  execFile: execFileMock,
}))

describe('OpenClaw runtime models adapter', () => {
  beforeEach(() => {
    execFileMock.mockClear()
    execFileAsyncMock.mockClear()
  })

  it('lists configured available models without requesting the full catalogue', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: '/bin/openclaw' } })

    const models = await runtime.models.listAvailable()

    expect(models).toEqual([
      expect.objectContaining({ id: 'configured/model', available: true }),
    ])
    expect(execFileAsyncMock).toHaveBeenCalledWith('/bin/openclaw', ['models', 'list', '--json'], expect.objectContaining({
      timeout: 15000,
    }))
  })

  it('uses a larger stdout buffer only when requesting unavailable models too', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: '/bin/openclaw' } })

    const models = await runtime.models.listAvailable({ includeUnavailable: true })

    expect(models.map(model => model.id)).toEqual(['configured/model', 'unavailable/model'])
    expect(execFileAsyncMock).toHaveBeenCalledWith('/bin/openclaw', ['models', 'list', '--all', '--json'], expect.objectContaining({
      timeout: 15000,
      maxBuffer: expect.any(Number),
    }))
    const calls = execFileAsyncMock.mock.calls as unknown as Array<[string, string[], { maxBuffer?: number }]>
    expect(calls[0]?.[2].maxBuffer).toBeGreaterThan(1024 * 1024)
  })
})
