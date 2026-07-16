/**
 * Pin: the Bakin-shipped role context TEACHES agents the schedule tools
 * (pi-parity D5 — "Bakin schedules are THE answer" only holds if agents on
 * a cron-less runtime actually learn to self-schedule through Bakin).
 * Composed managed blocks are built from these constants, so asserting here
 * pins every projected AGENTS.md.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-schedule-context-${Date.now()}`)
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import { ROLE_DEFAULTS } from '../../src/core/team-context-defaults'

describe('role context teaches Bakin scheduling', () => {
  it('subagent rules carry the schedule tool family + the no-native-cron rule', () => {
    const rules = ROLE_DEFAULTS.subagent
    expect(rules).toContain('bakin_exec_schedule_create')
    expect(rules).toContain('bakin_exec_schedule_list')
    expect(rules).toContain('NEVER use runtime-native cron')
  })

  it('code/GitHub guidance is present (worktrees + ask-before-default-branch)', () => {
    const rules = ROLE_DEFAULTS.subagent
    expect(rules).toContain('bakin_exec_git_prepare_worktree')
    expect(rules).toContain('gh')
    expect(rules).toMatch(/default branch/i)
  })
})
