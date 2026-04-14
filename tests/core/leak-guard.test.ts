/**
 * Regression test for the runtime guards in content-dir.ts and openclaw-home.ts.
 *
 * The guards are meant to catch any test run that would otherwise leak data
 * into the developer's real ~/.bakin/ or ~/.openclaw/. This file intentionally
 * triggers each guard to verify it still throws — if someone weakens or
 * removes the guard, this test fails and the leak protection is restored
 * before it can cause another incident.
 *
 * We deliberately do NOT mock content-dir or openclaw-home here: those are
 * the modules under test. The test-mock checker hook allows this via the
 * self-test exception in .claude/hooks/check-test-mocks.mjs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

describe('leak guard — content-dir', () => {
  const origBakinHome = process.env.BAKIN_HOME
  const origContentDir = process.env.CONTENT_DIR
  const origHome = process.env.HOME

  beforeEach(() => {
    vi.resetModules()
    delete process.env.BAKIN_HOME
    delete process.env.CONTENT_DIR
  })

  afterEach(() => {
    if (origBakinHome !== undefined) process.env.BAKIN_HOME = origBakinHome
    else delete process.env.BAKIN_HOME
    if (origContentDir !== undefined) process.env.CONTENT_DIR = origContentDir
    else delete process.env.CONTENT_DIR
    if (origHome !== undefined) process.env.HOME = origHome
    vi.resetModules()
  })

  it('throws when BAKIN_HOME points at the real ~/.bakin/', async () => {
    process.env.HOME = '/tmp/bakin-leak-guard-fake-home'
    process.env.BAKIN_HOME = join(process.env.HOME, '.bakin')

    const { getContentDir } = await import('../../packages/core/src/content-dir')
    expect(() => getContentDir()).toThrow(/real Bakin home/)
  })

  it('does NOT throw when BAKIN_HOME points at a temp directory', async () => {
    process.env.HOME = '/tmp/bakin-leak-guard-fake-home'
    process.env.BAKIN_HOME = join(tmpdir(), `bakin-leak-guard-safe-${Date.now()}`)

    const { getContentDir } = await import('../../packages/core/src/content-dir')
    expect(() => getContentDir()).not.toThrow()
  })

  it('guard message includes remediation instructions', async () => {
    process.env.HOME = '/tmp/bakin-leak-guard-fake-home'
    process.env.BAKIN_HOME = join(process.env.HOME, '.bakin')

    const { getContentDir } = await import('../../packages/core/src/content-dir')
    try {
      getContentDir()
      throw new Error('expected throw')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('mock src/core/content-dir')
      expect(msg).toContain('BAKIN_HOME')
      expect(msg).toContain('CLAUDE.md')
    }
  })
})

describe('leak guard — openclaw-home', () => {
  const origOpenClawHome = process.env.OPENCLAW_HOME
  const origHome = process.env.HOME

  beforeEach(() => {
    vi.resetModules()
    delete process.env.OPENCLAW_HOME
  })

  afterEach(() => {
    if (origOpenClawHome !== undefined) process.env.OPENCLAW_HOME = origOpenClawHome
    else delete process.env.OPENCLAW_HOME
    if (origHome !== undefined) process.env.HOME = origHome
    vi.resetModules()
  })

  it('throws when OPENCLAW_HOME points at the real ~/.openclaw/', async () => {
    process.env.HOME = '/tmp/bakin-leak-guard-fake-home'
    process.env.OPENCLAW_HOME = join(process.env.HOME, '.openclaw')

    const { getOpenClawHome } = await import('../../packages/core/src/openclaw-home')
    expect(() => getOpenClawHome()).toThrow(/real OpenClaw home/)
  })

  it('does NOT throw when OPENCLAW_HOME points at a temp directory', async () => {
    process.env.HOME = '/tmp/bakin-leak-guard-fake-home'
    process.env.OPENCLAW_HOME = join(tmpdir(), `openclaw-leak-guard-safe-${Date.now()}`)

    const { getOpenClawHome } = await import('../../packages/core/src/openclaw-home')
    expect(() => getOpenClawHome()).not.toThrow()
  })

  it('getOpenClawPath() also trips the guard', async () => {
    process.env.HOME = '/tmp/bakin-leak-guard-fake-home'
    process.env.OPENCLAW_HOME = join(process.env.HOME, '.openclaw')

    const { getOpenClawPath } = await import('../../packages/core/src/openclaw-home')
    expect(() => getOpenClawPath('flows', 'registry.sqlite')).toThrow(/real OpenClaw home/)
  })

  it('guard message includes remediation instructions', async () => {
    process.env.HOME = '/tmp/bakin-leak-guard-fake-home'
    process.env.OPENCLAW_HOME = join(process.env.HOME, '.openclaw')

    const { getOpenClawHome } = await import('../../packages/core/src/openclaw-home')
    try {
      getOpenClawHome()
      throw new Error('expected throw')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('mock @bakin/core/openclaw-home')
      expect(msg).toContain('OPENCLAW_HOME')
      expect(msg).toContain('CLAUDE.md')
    }
  })
})
