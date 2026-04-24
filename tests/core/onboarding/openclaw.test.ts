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
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync as realExistsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let fakeHome: string
const fakeContentDir = join(tmpdir(), `bakin-test-openclaw-content-${Date.now()}-${Math.random().toString(36).slice(2)}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => fakeContentDir,
  getBakinPaths: () => ({
    home: fakeContentDir,
    settings: join(fakeContentDir, 'settings.json'),
    logs: join(fakeContentDir, 'logs'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
}))

mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => fakeHome,
  getOpenClawPath: (...segments: string[]) => join(fakeHome, ...segments),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

// Gate fs.existsSync so binary-candidate lookups (which include real
// system paths like /opt/homebrew/bin/openclaw) only succeed for files
// inside the per-test sandbox. Everything else, including whatever the
// machine running the suite has in /opt/homebrew/, looks absent.
// readFileSync is passed through unchanged so JSON parsing still works.
mock.module('fs', async () => {
  const actual = await import('fs')
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
      // Minimal valid config: one 'main' agent satisfies the integrity
      // validator, so this test can focus on binary discovery.
      writeFileSync(
        join(fakeHome, 'openclaw.json'),
        JSON.stringify({ agents: { list: [{ id: 'main' }] } })
      )
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

  /**
   * Integrity validator. These tests exercise the reports-only scan that
   * runs after openclaw.json parses successfully. Each test writes a
   * specific fixture openclaw.json, then re-imports the openclaw component
   * to pick up the fresh state, then asserts `check()` reports (or does
   * not report) the expected violations. `vi.resetModules()` is called
   * between imports so the openclaw-config mtime cache doesn't bleed.
   */
  describe('integrity check', () => {
    async function importCheck() {
      vi.resetModules()
      const mod = await import('../../../src/core/onboarding/openclaw')
      return mod.openclawComponent.check
    }

    function setupBinary(): void {
      const binaryDir = join(fakeHome, 'bin')
      const binaryPath = join(binaryDir, 'openclaw')
      mkdirSync(binaryDir, { recursive: true })
      writeFileSync(binaryPath, '#!/bin/sh\n', { mode: 0o755 })
      process.env.OPENCLAW_PATH = binaryPath
    }

    function writeConfig(config: unknown): void {
      writeFileSync(join(fakeHome, 'openclaw.json'), JSON.stringify(config))
    }

    it('passes a clean config with a main entry and distinct workspaces', async () => {
      setupBinary()
      writeConfig({
        agents: {
          list: [
            { id: 'main', workspace: '/tmp/main-ws' },
            { id: 'alpha', workspace: '/tmp/alpha-ws' },
            { id: 'beta', workspace: '/tmp/beta-ws' },
          ],
        },
      })
      const check = await importCheck()
      const result = await check()
      expect(result.status).toBe('ok')
      expect(result.message).toContain('installed')
    })

    it("reports an error when no agent has id 'main'", async () => {
      setupBinary()
      writeConfig({ agents: { list: [{ id: 'bob', workspace: '/tmp/bob' }] } })
      const check = await importCheck()
      const result = await check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('no agent')
      expect(result.message).toContain("'main'")
      const issues = result.details?.integrityIssues as string[] | undefined
      expect(Array.isArray(issues)).toBe(true)
      expect(issues?.length).toBe(1)
    })

    it('reports an error when two agents share the same id', async () => {
      setupBinary()
      writeConfig({
        agents: {
          list: [
            { id: 'main', workspace: '/tmp/main-ws' },
            { id: 'main', workspace: '/tmp/other-ws' },
          ],
        },
      })
      const check = await importCheck()
      const result = await check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('duplicate')
      expect(result.message).toContain("'main'")
    })

    it('reports an error when two agents collide on defaults.workspace', async () => {
      setupBinary()
      writeConfig({
        agents: {
          defaults: { workspace: '/shared' },
          list: [{ id: 'main' }, { id: 'main-operator' }],
        },
      })
      const check = await importCheck()
      const result = await check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain("'main'")
      expect(result.message).toContain("'main-operator'")
      expect(result.message).toContain('/shared')
    })

    it('reports an error when two agents share an explicit workspace path', async () => {
      setupBinary()
      writeConfig({
        agents: {
          list: [
            { id: 'a', workspace: '/x' },
            { id: 'b', workspace: '/x' },
            { id: 'main', workspace: '/y' },
          ],
        },
      })
      const check = await importCheck()
      const result = await check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain("'a'")
      expect(result.message).toContain("'b'")
      expect(result.message).toContain('/x')
      // main is fine here; the report should be about the a/b collision only
      const issues = result.details?.integrityIssues as string[] | undefined
      expect(issues?.length).toBe(1)
    })

    it('reports multiple violations in a single run', async () => {
      setupBinary()
      writeConfig({
        agents: {
          list: [
            // no 'main' entry AND a duplicate id
            { id: 'alpha', workspace: '/tmp/alpha' },
            { id: 'alpha', workspace: '/tmp/alpha-two' },
          ],
        },
      })
      const check = await importCheck()
      const result = await check()
      expect(result.status).toBe('broken')
      const issues = result.details?.integrityIssues as string[] | undefined
      expect(issues).toBeDefined()
      expect(issues!.length).toBe(2)
      expect(issues!.some((i) => i.includes('no agent'))).toBe(true)
      expect(issues!.some((i) => i.includes('duplicate'))).toBe(true)
    })

    it('preserves the existing "openclaw.json missing" behavior when the file is absent', async () => {
      setupBinary()
      // Intentionally do NOT write openclaw.json
      const check = await importCheck()
      const result = await check()
      expect(result.status).toBe('broken')
      expect(result.message).toContain('openclaw.json')
      expect(result.message).toContain('missing')
      // No integrity issues emitted — we short-circuited before the validator
      expect(result.details?.integrityIssues).toBeUndefined()
    })

    it('skips agents with no resolved workspace instead of reporting a false collision', async () => {
      setupBinary()
      writeConfig({
        agents: {
          // No defaults.workspace, two entries with no workspace field:
          // neither resolves to a path, so there's nothing to collide.
          list: [{ id: 'main' }, { id: 'main-operator' }],
        },
      })
      const check = await importCheck()
      const result = await check()
      expect(result.status).toBe('ok')
    })
  })
})
