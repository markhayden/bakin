/**
 * Regression test for plugins/health/lib/managed-blocks.ts.
 *
 * Migrated from tests/core/doctor-managed-blocks.test.ts in #139 C9.
 * Pins the existing managed-block flow byte-equal so the registered
 * health.managed-blocks check can be lifted in without changing
 * observed behavior. Cases:
 *
 *   - Block missing + autoFix=true → block appended with one blank line
 *     of separation; trailing newline; rest of file untouched
 *   - Block missing + autoFix=false → no write, warn returned
 *   - Block present + body matches expected → ok, no write
 *   - Block present + body drifted + autoFix=true → in-place update,
 *     surrounding content preserved exactly
 *   - Block present + body drifted + autoFix=false → warn, no write
 *   - Start marker without end marker → error result, no write
 *   - main agent skipped (orchestrator owns its own AGENTS.md)
 *
 * Test isolation per CC-6: mocks both content-dir and openclaw-home to
 * temp dirs and seeds a synthetic OpenClaw roster. The doctor's other
 * checks are sidestepped by calling `applyAllManagedBlocks` directly.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-doctor-blocks-${Date.now()}-${randomUUID()}`)
const openClawDir = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@bakin/core/openclaw-config', () => ({
  readOpenClawConfig: () => ({
    agents: {
      list: [
        { id: 'main' },
        { id: 'pixel', identity: { name: 'Pixel' } },
        { id: 'rolo', identity: { name: 'Rolo' } },
      ],
    },
  }),
  resetOpenClawConfigCache: () => {},
  getAgentList: () => [
    { id: 'main' },
    { id: 'pixel', identity: { name: 'Pixel' } },
    { id: 'rolo', identity: { name: 'Rolo' } },
  ],
  getAgentIds: () => ['main', 'pixel', 'rolo'],
  findAgentById: (id: string) =>
    [
      { id: 'main' },
      { id: 'pixel', identity: { name: 'Pixel' } },
      { id: 'rolo', identity: { name: 'Rolo' } },
    ].find((a) => a.id === id) ?? null,
}))

import { applyAllManagedBlocks } from '../../../plugins/health/lib/managed-blocks'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function workspacePath(agentId: string): string {
  return join(openClawDir, 'workspaces', agentId)
}

function agentsMdPath(agentId: string): string {
  return join(workspacePath(agentId), 'AGENTS.md')
}

function seedAgentsMd(agentId: string, content: string): void {
  mkdirSync(workspacePath(agentId), { recursive: true })
  writeFileSync(agentsMdPath(agentId), content, 'utf-8')
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
})

describe('applyAllManagedBlocks — block missing', () => {
  it('with autoFix=true, appends every managed block with one-blank-line separation and trailing newline', () => {
    seedAgentsMd('pixel', '# Pixel — Image Artist\n\nResponsibilities go here.\n')

    const results = applyAllManagedBlocks(true)
    expect(results.some((r) => r.status === 'fixed')).toBe(true)

    const final = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(final.startsWith('# Pixel — Image Artist\n\nResponsibilities go here.\n\n<!-- bakin:'))
      .toBe(true)
    expect(final).toContain('<!-- bakin:mission-control:start -->')
    expect(final).toContain('<!-- bakin:mission-control:end -->')
    expect(final).toContain('<!-- bakin:hard-rules:start -->')
    expect(final).toContain('<!-- bakin:dependency-pattern:start -->')
    // Final byte should be a newline (matches doctor's append convention)
    expect(final.endsWith('\n')).toBe(true)
  })

  it('with autoFix=false, returns warn diagnostics without writing', () => {
    seedAgentsMd('pixel', '# Pixel\n')

    const before = readFileSync(agentsMdPath('pixel'), 'utf-8')
    const results = applyAllManagedBlocks(false)

    expect(results.some((r) => r.status === 'warn' && r.autoFixable)).toBe(true)
    expect(readFileSync(agentsMdPath('pixel'), 'utf-8')).toBe(before)
  })
})

describe('applyAllManagedBlocks — block present', () => {
  it('with body matching expected, returns ok, leaves file byte-equal', () => {
    // Seed both rostered subagents so applyAll doesn't return warn for
    // missing AGENTS.md on rolo.
    seedAgentsMd('pixel', '# Pixel\n\nProse.\n')
    seedAgentsMd('rolo', '# Rolo\n')

    // First pass: write the blocks via autoFix
    applyAllManagedBlocks(true)
    const pixelAfterFirst = readFileSync(agentsMdPath('pixel'), 'utf-8')
    const roloAfterFirst = readFileSync(agentsMdPath('rolo'), 'utf-8')

    // Second pass: scoped to pixel + rolo, should be all-ok or fixed (no warn/error)
    const results = applyAllManagedBlocks(true)
    expect(
      results.every((r) => r.status === 'ok' || r.status === 'fixed'),
    ).toBe(true)
    const okCount = results.filter((r) => r.status === 'ok').length
    expect(okCount).toBeGreaterThan(0)

    // Files unchanged on second pass
    expect(readFileSync(agentsMdPath('pixel'), 'utf-8')).toBe(pixelAfterFirst)
    expect(readFileSync(agentsMdPath('rolo'), 'utf-8')).toBe(roloAfterFirst)
  })

  it('with drifted body and autoFix=true, in-place updates while preserving surrounding content', () => {
    const stale = `# Pixel

Prose before.

<!-- bakin:mission-control:start -->
this is some stale content
<!-- bakin:mission-control:end -->

Prose after.
`
    seedAgentsMd('pixel', stale)

    applyAllManagedBlocks(true)
    const final = readFileSync(agentsMdPath('pixel'), 'utf-8')

    // Surrounding content preserved
    expect(final.startsWith('# Pixel\n\nProse before.\n\n<!-- bakin:mission-control:start -->')).toBe(true)
    expect(final).toContain('Prose after.')
    // Stale content gone
    expect(final).not.toContain('this is some stale content')
    // Mission-control markers still present
    expect(final).toContain('<!-- bakin:mission-control:start -->')
    expect(final).toContain('<!-- bakin:mission-control:end -->')
  })

  it('with drifted body and autoFix=false, returns warn, no write', () => {
    const stale = `<!-- bakin:mission-control:start -->
stale content
<!-- bakin:mission-control:end -->
`
    seedAgentsMd('pixel', stale)
    const before = readFileSync(agentsMdPath('pixel'), 'utf-8')

    const results = applyAllManagedBlocks(false)
    expect(
      results.some(
        (r) => r.status === 'warn' && r.check === 'agent-mission-control' && r.autoFixable,
      ),
    ).toBe(true)
    expect(readFileSync(agentsMdPath('pixel'), 'utf-8')).toBe(before)
  })
})

describe('applyAllManagedBlocks — malformed file', () => {
  it('returns error for the malformed block, does not rewrite the orphan-start region', () => {
    const broken = `# Pixel\n\n<!-- bakin:mission-control:start -->\nstuck content with no end marker`
    seedAgentsMd('pixel', broken)

    const results = applyAllManagedBlocks(true)

    // Mission-control specifically errors out — its orphan start marker stays
    // untouched (no replacement, no end marker injected by the doctor's path).
    expect(
      results.some((r) => r.status === 'error' && r.check === 'agent-mission-control'),
    ).toBe(true)

    const after = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(after).toContain('<!-- bakin:mission-control:start -->\nstuck content with no end marker')
    // Doctor must NOT silently inject an end marker for mission-control
    expect(after).not.toContain('<!-- bakin:mission-control:end -->')

    // OTHER managed blocks have no markers, so doctor still appends them.
    expect(after).toContain('<!-- bakin:hard-rules:start -->')
    expect(after).toContain('<!-- bakin:hard-rules:end -->')
  })
})

describe('applyAllManagedBlocks — main agent skip', () => {
  it('does not touch main agent`s AGENTS.md', () => {
    seedAgentsMd('main', '# Main\n')
    seedAgentsMd('pixel', '# Pixel\n')

    applyAllManagedBlocks(true)

    // main was not touched — still no markers
    const mainContent = readFileSync(agentsMdPath('main'), 'utf-8')
    expect(mainContent).not.toContain('<!-- bakin:mission-control')

    // pixel was touched
    const pixelContent = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(pixelContent).toContain('<!-- bakin:mission-control:start -->')
  })
})

describe('applyAllManagedBlocks — missing AGENTS.md', () => {
  it('returns warn when an agent has no AGENTS.md, does not create one', () => {
    // pixel is in the roster but we don't seed AGENTS.md
    mkdirSync(workspacePath('pixel'), { recursive: true })

    const results = applyAllManagedBlocks(true)
    expect(results.some((r) => r.status === 'warn' && r.message.includes('AGENTS.md not found'))).toBe(true)
    expect(existsSync(agentsMdPath('pixel'))).toBe(false)
  })
})
