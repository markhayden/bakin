import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock fs.existsSync to control binary/config detection
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return { ...actual, existsSync: vi.fn(() => false) }
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
    vi.restoreAllMocks()
  })

  it('passes when no OpenClaw signals are found', async () => {
    mockExistsSync.mockReturnValue(false)
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { checkSafety } = await import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('fails when binary is found', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      return String(p).includes('openclaw') && !String(p).includes('openclaw.json')
    })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { checkSafety } = await import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(false)
    expect(result.reasons.some(r => r.includes('binary'))).toBe(true)
  })

  it('fails when config file exists', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      return String(p).includes('openclaw.json')
    })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

    const { checkSafety } = await import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(false)
    expect(result.reasons.some(r => r.includes('config'))).toBe(true)
  })

  it('fails when gateway is responding', async () => {
    mockExistsSync.mockReturnValue(false)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const { checkSafety } = await import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(false)
    expect(result.reasons.some(r => r.includes('Gateway'))).toBe(true)
  })

  it('bypasses all checks when OPENCLAW_MOCK_FORCE=1', async () => {
    process.env.OPENCLAW_MOCK_FORCE = '1'
    mockExistsSync.mockReturnValue(true)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }))

    const { checkSafety } = await import('../../dev/imitation-crab/safety')
    const result = await checkSafety()
    expect(result.safe).toBe(true)
  })
})
