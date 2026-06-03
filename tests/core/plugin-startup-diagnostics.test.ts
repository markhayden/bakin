import { afterEach, describe, expect, it, mock } from 'bun:test'
import { startStartupSpan } from '../../src/core/startup-diagnostics'

describe('startup diagnostics', () => {
  const originalStartupDiagnostics = process.env.BAKIN_STARTUP_DIAGNOSTICS
  const originalConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  const originalLogLevel = process.env.BAKIN_LOG_LEVEL
  const originalSlowMs = process.env.BAKIN_STARTUP_SLOW_MS

  afterEach(() => {
    if (originalStartupDiagnostics === undefined) delete process.env.BAKIN_STARTUP_DIAGNOSTICS
    else process.env.BAKIN_STARTUP_DIAGNOSTICS = originalStartupDiagnostics
    if (originalConsoleFormat === undefined) delete process.env.BAKIN_CONSOLE_FORMAT
    else process.env.BAKIN_CONSOLE_FORMAT = originalConsoleFormat
    if (originalLogLevel === undefined) delete process.env.BAKIN_LOG_LEVEL
    else process.env.BAKIN_LOG_LEVEL = originalLogLevel
    if (originalSlowMs === undefined) delete process.env.BAKIN_STARTUP_SLOW_MS
    else process.env.BAKIN_STARTUP_SLOW_MS = originalSlowMs
  })

  it('does not log when startup diagnostics are disabled', () => {
    process.env.BAKIN_STARTUP_DIAGNOSTICS = '0'
    let now = 0
    const log = {
      debug: mock(),
      warn: mock(),
    }
    const span = startStartupSpan(log, 'plugin.activate', {
      phase: 'plugin',
      pluginId: 'tasks',
      now: () => now,
    })

    now = 42
    const result = span.end({ status: 'ok' })

    expect(result.durationMs).toBe(42)
    expect(log.debug).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('logs a structured startup span when it ends', () => {
    let now = 10
    const log = {
      debug: mock(),
      warn: mock(),
    }
    const span = startStartupSpan(log, 'plugin.activate', {
      phase: 'plugin',
      pluginId: 'tasks',
      pluginSource: 'core',
      enabled: true,
      thresholdMs: 100,
      now: () => now,
    })

    now = 42.345
    const result = span.end({ status: 'ok', routes: 3 })

    expect(result).toEqual({
      phase: 'plugin',
      span: 'plugin.activate',
      durationMs: 32.35,
      status: 'ok',
    })
    expect(log.debug).toHaveBeenCalledWith('startup span', {
      category: 'startup',
      phase: 'plugin',
      span: 'plugin.activate',
      durationMs: 32.35,
      status: 'ok',
      pluginId: 'tasks',
      pluginSource: 'core',
      routes: 3,
    })
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('warns when a non-skipped span exceeds the slow threshold', () => {
    let now = 0
    const log = {
      debug: mock(),
      warn: mock(),
    }
    const span = startStartupSpan(log, 'plugin.onReady', {
      phase: 'plugin',
      pluginId: 'schedule',
      pluginSource: 'core',
      enabled: true,
      thresholdMs: 250,
      now: () => now,
    })

    now = 251
    span.end()

    expect(log.warn).toHaveBeenCalledWith('slow startup span', expect.objectContaining({
      phase: 'plugin',
      span: 'plugin.onReady',
      durationMs: 251,
      status: 'ok',
      pluginId: 'schedule',
      pluginSource: 'core',
    }))
  })

  it('can emit slow warnings without a debug span', () => {
    let now = 0
    const log = {
      debug: mock(),
      warn: mock(),
    }
    const span = startStartupSpan(log, 'pluginManifest.assetVersion', {
      phase: 'manifest',
      pluginId: 'tasks',
      enabled: true,
      debug: false,
      thresholdMs: 10,
      now: () => now,
    })

    now = 11
    span.end({ asset: 'client.js' })

    expect(log.debug).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith('slow startup span', expect.objectContaining({
      span: 'pluginManifest.assetVersion',
      durationMs: 11,
      pluginId: 'tasks',
      asset: 'client.js',
    }))
  })

  it('does not warn for skipped spans even when they exceed the threshold', () => {
    let now = 0
    const log = {
      debug: mock(),
      warn: mock(),
    }
    const span = startStartupSpan(log, 'pluginRegistry.initialize', {
      phase: 'plugins',
      enabled: true,
      thresholdMs: 1,
      now: () => now,
    })

    now = 10
    span.end({ status: 'skipped', reason: 'already-initialized' })

    expect(log.debug).toHaveBeenCalledWith('startup span', expect.objectContaining({
      status: 'skipped',
      reason: 'already-initialized',
    }))
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('redacts local paths from diagnostic error fields', () => {
    let now = 0
    const log = {
      debug: mock(),
      warn: mock(),
    }
    const span = startStartupSpan(log, 'plugin.import', {
      phase: 'plugin',
      pluginId: 'x',
      enabled: true,
      now: () => now,
    })

    now = 2
    span.end({
      status: 'error',
      error: 'Cannot import /Users/roscoe/.bakin/plugins/x/dist/index.js from file:///private/tmp/plugin.js',
    })

    const payload = log.debug.mock.calls[0][1] as Record<string, unknown>
    expect(payload.error).toContain('[path]')
    expect(String(payload.error)).not.toContain('/Users/roscoe')
    expect(String(payload.error)).not.toContain('file:///private/tmp')
  })

  it('is idempotent when end is called more than once', () => {
    let now = 0
    const log = {
      debug: mock(),
      warn: mock(),
    }
    const span = startStartupSpan(log, 'plugin.load', {
      phase: 'plugin',
      enabled: true,
      now: () => now,
    })

    now = 5
    const first = span.end()
    now = 10
    const second = span.end({ status: 'error' })

    expect(second).toBe(first)
    expect(log.debug).toHaveBeenCalledTimes(1)
  })
})
