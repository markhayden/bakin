import { describe, it, expect, afterEach, mock, spyOn, type Mock } from 'bun:test'

// Mock fs.existsSync to control binary/config detection
mock.module('fs', () => {
  const actual = require('fs') as typeof import('fs')
  return { ...actual, existsSync: mock(() => false) }
})

import { existsSync } from 'fs'
const mockExistsSync = vi.mocked(existsSync)

describe('mock safety gate', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
    mockExistsSync.mockReturnValue(false)

    // Reset fetch mock
    mock.restore()
  })

  it('passes when no OpenClaw signals are found', async () => {
    mockExistsSync.mockReturnValue(false)
    spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { checkSafety } = require('../../dev/imitation-crab/safety') as typeof import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('fails when binary is found', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      return String(p).includes('openclaw') && !String(p).includes('openclaw.json')
    })
    spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { checkSafety } = require('../../dev/imitation-crab/safety') as typeof import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(false)
    expect(result.reasons.some(r => r.includes('binary'))).toBe(true)
  })

  it('fails when config file exists', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      return String(p).includes('openclaw.json')
    })
    spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { checkSafety } = require('../../dev/imitation-crab/safety') as typeof import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(false)
    expect(result.reasons.some(r => r.includes('config'))).toBe(true)
  })

  it('fails when gateway is responding', async () => {
    mockExistsSync.mockReturnValue(false)
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const { checkSafety } = require('../../dev/imitation-crab/safety') as typeof import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(false)
    expect(result.reasons.some(r => r.includes('Gateway'))).toBe(true)
  })

  it('bypasses all checks when OPENCLAW_MOCK_FORCE=1', async () => {
    process.env.OPENCLAW_MOCK_FORCE = '1'
    mockExistsSync.mockReturnValue(true)
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const { checkSafety } = require('../../dev/imitation-crab/safety') as typeof import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(true)
  })
})
