/**
 * Source-level CLI smoke test for `bakin agents *` and `bakin packages *`
 * (Phase F-1).
 *
 * The full CLI dispatch lives in cli/bakin.ts and runs `main()` at module
 * load — invoking it under bun:test would trigger process.exit. Instead
 * we assert the dispatcher source contains the expected case branches +
 * function call sites. Behavioral coverage of the underlying handlers
 * lives in tests/api/agent-packages-routes.test.ts.
 */
import { describe, it, expect, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-cli-agents-${Date.now()}`)

// CC-6 mocks (defensive — this test only reads source bytes, no fs ops via
// bakin modules, but the rule applies to every test in this feature).
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

const CLI_SOURCE = readFileSync(
  join(import.meta.dir, '..', '..', 'cli', 'bakin.ts'),
  'utf-8',
)

describe('cli: agents subcommands', () => {
  it('exposes install / list / orphan / remove / delete / sync / lessons subcommands', () => {
    expect(CLI_SOURCE).toContain("case 'agents':")
    expect(CLI_SOURCE).toContain("sub === 'install'")
    expect(CLI_SOURCE).toContain("sub === 'orphan'")
    expect(CLI_SOURCE).toContain("sub === 'remove'")
    expect(CLI_SOURCE).toContain("sub === 'delete'")
    expect(CLI_SOURCE).toContain("sub === 'sync'")
    expect(CLI_SOURCE).toContain("sub === 'lessons'")
  })

  it('routes agents install to cmdAgentPackagesInstall', () => {
    expect(CLI_SOURCE).toContain('cmdAgentPackagesInstall(args[2]')
  })

  it('routes agents remove to cmdAgentPackagesRemove', () => {
    expect(CLI_SOURCE).toContain('cmdAgentPackagesRemove(args[2]')
  })

  it('routes agents orphan and delete to explicit remove modes', () => {
    expect(CLI_SOURCE).toContain("cmdAgentPackagesOrphan(args[2]")
    expect(CLI_SOURCE).toContain("cmdAgentPackagesDelete(args[2]")
  })

  it('routes agents sync to cmdAgentPackagesSync', () => {
    expect(CLI_SOURCE).toContain('cmdAgentPackagesSync')
  })

  it('routes agents lessons enable/disable to cmdAgentPackagesLessonsToggle', () => {
    expect(CLI_SOURCE).toContain('cmdAgentPackagesLessonsToggle(args[3], args[4]')
  })

  it('routes agents lessons list to cmdAgentPackagesLessonsList', () => {
    expect(CLI_SOURCE).toContain('cmdAgentPackagesLessonsList(args[3])')
  })

  it('preserves the existing runtime subcommands (status / tasks / send)', () => {
    expect(CLI_SOURCE).toContain("sub === 'status'")
    expect(CLI_SOURCE).toContain("sub === 'tasks'")
    expect(CLI_SOURCE).toContain("sub === 'send'")
  })
})

describe('cli: packages subcommands', () => {
  it('exposes install / list / remove / sync', () => {
    expect(CLI_SOURCE).toContain("case 'packages':")
    expect(CLI_SOURCE).toContain('cmdPackagesInstall(args[2]')
    expect(CLI_SOURCE).toContain('cmdPackagesList(parseAgentsFlags')
    expect(CLI_SOURCE).toContain('cmdPackagesRemove(args[2]')
    expect(CLI_SOURCE).toContain('cmdPackagesSync(args[2]')
  })
})

describe('cli: parseAgentsFlags handles all documented flags', () => {
  it('parses the full flag set in source', () => {
    expect(CLI_SOURCE).toContain("case '--adopt':")
    expect(CLI_SOURCE).toContain("case '--install-as':")
    expect(CLI_SOURCE).toContain("case '--replace':")
    expect(CLI_SOURCE).toContain("case '--keep-blocks':")
    expect(CLI_SOURCE).toContain("case '--delete-agent':")
    expect(CLI_SOURCE).toContain("case '--delete':")
    expect(CLI_SOURCE).toContain("case '--orphan':")
    expect(CLI_SOURCE).toContain("case '--reclaim':")
    expect(CLI_SOURCE).toContain("case '--check':")
    expect(CLI_SOURCE).toContain("case '--force':")
    expect(CLI_SOURCE).toContain("case '--json':")
  })
})

describe('cli: API endpoints reached by new commands', () => {
  it('hits /api/agent-packages and /api/packages, not /api/agents/...', () => {
    expect(CLI_SOURCE).toContain("'/api/agent-packages/install'")
    expect(CLI_SOURCE).toContain("'/api/agent-packages'")
    expect(CLI_SOURCE).toContain("'/api/packages/install'")
    expect(CLI_SOURCE).toContain("'/api/packages'")
    // ensure we don't try to install at the runtime /api/agents path
    expect(CLI_SOURCE).not.toContain("'/api/agents/install'")
  })
})
