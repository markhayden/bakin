/**
 * Tests for the openclaw onboarding component.
 *
 * OpenClaw is a hard prerequisite — Bakin never installs it automatically.
 * This test suite verifies:
 *   - Detection reports the right granular failure state (home missing /
 *     binary missing / config missing / config corrupt / all ok)
 *   - install() is a noop that never touches the filesystem
 *   - The install-URL message is consistent across all failure paths
 *
 * Uses vi.mock for @bakin/core/openclaw-home (aliased in vitest.config.ts)
 * so the component's `getOpenClawHome()` call redirects to a temp dir we
 * control, and for `fs.existsSync` on the binary candidate paths — the
 * latter we mock because the candidate list includes real system paths
 * like /opt/homebrew/bin/openclaw that a dev machine may actually have.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync as realExistsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let fakeHome: string

vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => fakeHome,
  getOpenClawPath: (...segments: string[]) => join(fakeHome, ...segments),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Gate fs.existsSync so binary-candidate lookups (which include real
// system paths like /opt/homebrew/bin/openclaw) only succeed for files
// inside the per-test sandbox. Everything else, including whatever the
// machine running the suite has in /opt/homebrew/, looks absent.
// readFileSync is passed through unchanged so JSON parsing still works.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: (p: fs.PathLike) => {
      const path = String(p)
      if (path.startsWith(fakeHome)) return actual.existsSync(p)
      return false
    },
  }
})
import type * as fs from 'fs'

describe('onboarding openclaw component', () => {
  let openclawComponent: typeof import('../../../src/core/onboarding/openclaw').openclawComponent
  let OPENCLAW_INSTALL_URL: string

  beforeEach(async () => {
    fakeHome = mkdtempSync(join(tmpdir(), 'bakin-onboarding-openclaw-'))
    delete process.env.OPENCLAW_PATH
    vi.resetModules()
    const mod = await import('../../../src/core/onboarding/openclaw')
    openclawComponent = mod.openclawComponent
    OPENCLAW_INSTALL_URL = mod.OPENCLAW_INSTALL_URL
  })

  afterEach(() => {
    if (realExistsSync(fakeHome)) {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  const opts = {
    interactive: false,
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }

  describe('check()', () => {
    it('reports missing when the OpenClaw home directory does not exist', async () => {
      rmSync(fakeHome, { recursive: true, force: true })
      // fakeHome reference still points at the deleted path — component sees missing
      const result = await openclawComponent.check()
      expect(result.status).toBe('missing')
      expect(result.remediation).toContain(OPENCLAW_INSTALL_URL)
      expect(result.message).toContain('home directory not found')
      // Re-create before afterEach tries to clean it up
      mkdirSync(fakeHome, { recursive: true })
    })

    it('reports missing when home exists but no binary is discoverable', async () => {
      // home dir exists (created by mkdtemp) but no binary in the sandbox
      const result = await openclawComponent.check()
      expect(result.status).toBe('missing')
      expect(result.message).toContain('binary not found')
      expect(result.details?.candidatesChecked).toBeDefined()
    })

    it('finds a binary via $OPENCLAW_PATH env var', async () => {
      const binaryDir = join(fakeHome, 'bin')
      const binaryPath = join(binaryDir, 'openclaw')
      mkdirSync(binaryDir, { recursive: true })
      writeFileSync(binaryPath, '#!/bin/sh\n', { mode: 0o755 })
      writeFileSync(join(fakeHome, 'openclaw.json'), JSON.stringify({ channels: {} }))
      process.env.OPENCLAW_PATH = binaryPath
      // Re-import to pick up the env var in the candidate builder
      vi.resetModules()
      const mod = await import('../../../src/core/onboarding/openclaw')

      const result = await mod.openclawComponent.check()
      expect(result.status).toBe('ok')
      expect(result.details?.binary).toBe(binaryPath)
    })

    it('reports broken when binary exists but openclaw.json is missing', async () => {
      const binaryDir = join(fakeHome, 'bin')
      const binaryPath = join(binaryDir, 'openclaw')
      mkdirSync(binaryDir, { recursive: true })
      writeFileSync(binaryPath, '#!/bin/sh\n', { mode: 0o755 })
      process.env.OPENCLAW_PATH = binaryPath
      vi.resetModules()
      const mod = await import('../../../src/core/onboarding/openclaw')

      const result = await mod.openclawComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('openclaw.json')
      expect(result.message).toContain('missing')
    })

    it('reports broken when openclaw.json is not valid JSON', async () => {
      const binaryDir = join(fakeHome, 'bin')
      const binaryPath = join(binaryDir, 'openclaw')
      mkdirSync(binaryDir, { recursive: true })
      writeFileSync(binaryPath, '#!/bin/sh\n', { mode: 0o755 })
      writeFileSync(join(fakeHome, 'openclaw.json'), 'not-json {{{')
      process.env.OPENCLAW_PATH = binaryPath
      vi.resetModules()
      const mod = await import('../../../src/core/onboarding/openclaw')

      const result = await mod.openclawComponent.check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('not valid JSON')
    })
  })

  describe('install()', () => {
    it('is a noop that returns the install URL message', async () => {
      const result = await openclawComponent.install(opts)
      expect(result.status).toBe('noop')
      expect(result.message).toContain(OPENCLAW_INSTALL_URL)
      expect(result.durationMs).toBe(0)
    })

    it('does not create the home directory', async () => {
      rmSync(fakeHome, { recursive: true, force: true })
      await openclawComponent.install(opts)
      // Noop → still missing
      expect(realExistsSync(fakeHome)).toBe(false)
    })
  })
})
