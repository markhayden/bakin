import { describe, it, expect, spyOn } from 'bun:test'
import { createLogger } from '../../src/core/logger'

describe('Logger', () => {
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
})
