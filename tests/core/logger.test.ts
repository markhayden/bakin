import { describe, it, expect, mock, spyOn } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// The logger resolves a log directory through the content-dir facade. The file
// transport is off under NODE_ENV=test, so nothing is written today — but the
// isolation rule is blanket precisely so a future transport change can't quietly
// start writing into the real ~/.bakin/logs.
const testDir = join(tmpdir(), `bakin-test-logger-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), logs: join(testDir, 'logs') }),
  isUsingBakinHome: () => true,
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

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

  function withStdoutTty(isTTY: boolean, run: () => void): void {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: isTTY,
    })
    try {
      run()
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, 'isTTY', descriptor)
      else delete (process.stdout as unknown as { isTTY?: boolean }).isTTY
    }
  }

  it('creates a logger with the given module name', () => {
    const log = createLogger('test-module')
    expect(log).toHaveProperty('debug')
    expect(log).toHaveProperty('info')
    expect(log).toHaveProperty('warn')
    expect(log).toHaveProperty('error')
  })

  /**
   * The suite runs under BAKIN_CONSOLE_FORMAT=silent (bunfig.toml) so logger
   * chatter doesn't bury real failures. A test asserting that the logger WRITES
   * must therefore state the format it is testing rather than inherit the
   * ambient one — inheriting made these four pass only by accident of the
   * environment they happened to run in.
   */
  const writesToConsole = { BAKIN_CONSOLE_FORMAT: 'plain', BAKIN_LOG_LEVEL: undefined }

  it('logs info messages to console.log', () => {
    withConsoleEnv(writesToConsole, () => {
      const spy = spyOn(console, 'log').mockImplementation(() => {})
      const log = createLogger('test')
      log.info('hello world')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain('[INFO]')
      expect(spy.mock.calls[0][0]).toContain('[test]')
      expect(spy.mock.calls[0][0]).toContain('hello world')
      spy.mockRestore()
    })
  })

  it('logs errors to console.error', () => {
    withConsoleEnv(writesToConsole, () => {
      const spy = spyOn(console, 'error').mockImplementation(() => {})
      const log = createLogger('test')
      log.error('something broke', new Error('boom'))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain('[ERROR]')
      expect(spy.mock.calls[0][0]).toContain('boom')
      spy.mockRestore()
    })
  })

  it('logs warnings to console.warn', () => {
    withConsoleEnv(writesToConsole, () => {
      const spy = spyOn(console, 'warn').mockImplementation(() => {})
      const log = createLogger('test')
      log.warn('careful', 'reason')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain('[WARN]')
      expect(spy.mock.calls[0][0]).toContain('reason')
      spy.mockRestore()
    })
  })

  it('includes data in log output', () => {
    withConsoleEnv(writesToConsole, () => {
      const spy = spyOn(console, 'log').mockImplementation(() => {})
      const log = createLogger('test')
      log.info('with data', { key: 'value' })
      expect(spy.mock.calls[0][0]).toContain('"key":"value"')
      spy.mockRestore()
    })
  })

  it('defaults to pretty output for interactive terminals', () => {
    withConsoleEnv({
      BAKIN_CONSOLE_FORMAT: undefined,
      BAKIN_LOG_LEVEL: undefined,
      NO_COLOR: '1',
    }, () => withStdoutTty(true, () => {
      const spy = spyOn(console, 'log').mockImplementation(() => {})
      const log = createLogger('server')
      log.info('booting')

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toMatch(/^\d\d:\d\d:\d\d\s+info\s+server\s+booting$/)
      spy.mockRestore()
    }))
  })

  it('defaults to plain output when stdout is not a terminal', () => {
    withConsoleEnv({
      BAKIN_CONSOLE_FORMAT: undefined,
      BAKIN_LOG_LEVEL: undefined,
      NO_COLOR: '1',
    }, () => withStdoutTty(false, () => {
      const spy = spyOn(console, 'log').mockImplementation(() => {})
      const log = createLogger('server')
      log.info('booting')

      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain('[INFO]')
      expect(spy.mock.calls[0][0]).toContain('[server]')
      spy.mockRestore()
    }))
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

  it('suppresses console output in silent mode', () => {
    withConsoleEnv({
      BAKIN_CONSOLE_FORMAT: 'silent',
      BAKIN_LOG_LEVEL: undefined,
      NO_COLOR: '1',
    }, () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
      const log = createLogger('app-services')
      log.info('booting')
      log.warn('not ready')
      log.error('failed')

      expect(logSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
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
