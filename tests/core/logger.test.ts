import { describe, it, expect, spyOn } from 'bun:test'
import { createLogger } from '../../src/core/logger'

describe('Logger', () => {
  function withConsoleEnv(env: Record<string, string | undefined>, run: () => void): void {
    const previous: Record<string, string | undefined> = {}
    for (const key of Object.keys(env)) {
      previous[key] = process.env[key]
      if (env[key] === undefined) delete process.env[key]
      else process.env[key] = env[key]
    }
    try {
      run()
    } finally {
      for (const key of Object.keys(env)) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
    }
  }

  it('creates a logger with the given module name', () => {
    const log = createLogger('test-module')
    expect(log).toHaveProperty('debug')
    expect(log).toHaveProperty('info')
    expect(log).toHaveProperty('warn')
    expect(log).toHaveProperty('error')
  })

  it('logs info messages to console.log', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})
    const log = createLogger('test')
    log.info('hello world')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('[INFO]')
    expect(spy.mock.calls[0][0]).toContain('[test]')
    expect(spy.mock.calls[0][0]).toContain('hello world')
    spy.mockRestore()
  })

  it('logs errors to console.error', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    const log = createLogger('test')
    log.error('something broke', new Error('boom'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('[ERROR]')
    expect(spy.mock.calls[0][0]).toContain('boom')
    spy.mockRestore()
  })

  it('logs warnings to console.warn', () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => {})
    const log = createLogger('test')
    log.warn('careful', 'reason')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('[WARN]')
    expect(spy.mock.calls[0][0]).toContain('reason')
    spy.mockRestore()
  })

  it('includes data in log output', () => {
    const spy = spyOn(console, 'log').mockImplementation(() => {})
    const log = createLogger('test')
    log.info('with data', { key: 'value' })
    expect(spy.mock.calls[0][0]).toContain('"key":"value"')
    spy.mockRestore()
  })

  it('renders pretty console output with compact source labels', () => {
    withConsoleEnv({
      BAKIN_CONSOLE_FORMAT: 'pretty',
      BAKIN_LOG_LEVEL: undefined,
      NO_COLOR: '1',
    }, () => {
      const spy = spyOn(console, 'log').mockImplementation(() => {})
      const log = createLogger('plugin-registry')
      log.info('Plugin loaded', { pluginId: 'tasks', version: '2.1.0' })

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toMatch(/^\d\d:\d\d:\d\d\s+info\s+plugin:tasks\s+Plugin loaded$/)
      expect(spy.mock.calls[0][0]).not.toContain('"pluginId"')
      spy.mockRestore()
    })
  })

  it('renders verbose console output with debug and data details', () => {
    withConsoleEnv({
      BAKIN_CONSOLE_FORMAT: 'verbose',
      BAKIN_LOG_LEVEL: undefined,
      NO_COLOR: '1',
    }, () => {
      const spy = spyOn(console, 'log').mockImplementation(() => {})
      const log = createLogger('dev')
      log.debug('trace step', { key: 'value' })

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain('debug')
      expect(spy.mock.calls[0][0]).toContain('dev')
      expect(spy.mock.calls[0][0]).toContain('trace step')
      expect(spy.mock.calls[0][0]).toContain('"key":"value"')
      spy.mockRestore()
    })
  })

  it('suppresses noisy Antfly info in pretty mode but keeps readiness lines', () => {
    withConsoleEnv({
      BAKIN_CONSOLE_FORMAT: 'pretty',
      BAKIN_LOG_LEVEL: undefined,
      NO_COLOR: '1',
    }, () => {
      const spy = spyOn(console, 'log').mockImplementation(() => {})
      const log = createLogger('app-services')
      log.info('Opening index at registration', { source: 'antfly', shardID: 'abc' })
      log.info('Metadata API server is ready', { source: 'antfly', address: '0.0.0.0:8080' })

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain('antfly')
      expect(spy.mock.calls[0][0]).toContain('Metadata API server is ready')
      spy.mockRestore()
    })
  })
})
