/**
 * The ONE tool-access renderer (P1.2). Golden fixtures pin the exact
 * agent-facing bytes for each style; structural assertions guard the
 * intent (in-process/mcp omit the exhaustive cheat-sheet, cli-shim carries
 * it) so a fixture re-baseline can never silently erase the contract.
 */
import { describe, it, expect, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// This suite is pure (type-only runtime imports), but the isolation guard
// requires the content-dir resolvers be mocked so nothing can ever leak.
const testDir = join(tmpdir(), `bakin-test-tool-access-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { renderToolAccessInstructions } from '../../src/core/tool-access'
import type { RuntimeToolAccess } from '../../packages/core/src/adapters/runtime'

const FIXTURES = join(import.meta.dir, '../fixtures/tool-access')
const golden = (name: string) => readFileSync(join(FIXTURES, `${name}.md`), 'utf-8').replace(/\n$/, '')

const CASES: Record<string, { access: RuntimeToolAccess; agentId: string }> = {
  'in-process': { access: { style: 'in-process' }, agentId: 'scout' },
  mcp: { access: { style: 'mcp', mcpServerTemplate: 'bakin-<agent>' }, agentId: 'scout' },
  'cli-shim': {
    access: { style: 'cli-shim', shimCommand: 'mcporter call bakin-<agent>.<tool> <args>' },
    agentId: 'scout',
  },
}

describe('renderToolAccessInstructions', () => {
  for (const [name, { access, agentId }] of Object.entries(CASES)) {
    it(`${name}: matches the golden fixture`, () => {
      expect(renderToolAccessInstructions(access, { agentId })).toBe(golden(name))
    })
  }

  it('in-process renders bare calls and NO cheat-sheet', () => {
    const out = renderToolAccessInstructions({ style: 'in-process' }, { agentId: 'scout' })
    expect(out).toContain('bakin_exec_tasks_get taskId=<id>')
    expect(out).not.toContain('mcporter')
    expect(out).not.toContain('.bakin_exec_')
    // Only the single Example line references a concrete tool — no exhaustive list.
    expect(out.match(/bakin_exec_tasks_/g)?.length ?? 0).toBe(1)
  })

  it('mcp prefixes tools with the per-agent server and omits the cheat-sheet', () => {
    const out = renderToolAccessInstructions(
      { style: 'mcp', mcpServerTemplate: 'bakin-<agent>' },
      { agentId: 'rolo' },
    )
    expect(out).toContain('bakin-rolo.bakin_exec_tasks_get')
    expect(out).not.toContain('Core tools you will use')
  })

  it('cli-shim carries the full cheat-sheet with the shim command substituted', () => {
    const out = renderToolAccessInstructions(
      { style: 'cli-shim', shimCommand: 'run bakin-<agent> <tool> <args>' },
      { agentId: 'pixel' },
    )
    expect(out).toContain('Core tools you will use')
    expect(out).toContain('run bakin-pixel bakin_exec_tasks_complete taskId=<id> summary="<what you did>"')
    // The exhaustive list is present: all five core tools.
    for (const tool of [
      'bakin_exec_tasks_get',
      'bakin_exec_tasks_log_progress',
      'bakin_exec_tasks_complete',
      'bakin_exec_tasks_block',
      'bakin_exec_assets_save',
    ]) {
      expect(out).toContain(tool)
    }
  })

  it('cli-shim without a shimCommand falls back to a labelled placeholder, not empty', () => {
    const out = renderToolAccessInstructions({ style: 'cli-shim' }, { agentId: 'scout' })
    expect(out).toContain('<shim-command>')
    expect(out).toContain('Core tools you will use')
  })
})
