/**
 * Foreground-only git (#978): every git Bakin spawns carries config that
 * keeps `gc --auto` / background maintenance from outliving the command in a
 * directory the caller is about to rename or delete. Pure module — no app
 * imports, no content dir.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = mkdtempSync(join(tmpdir(), 'bakin-git-args-'))
// The module under test touches no home, but every test under tests/ pins the
// content dir away from ~/.bakin regardless (CLAUDE.md isolation rule).
const contentDirMock = () => ({ getContentDir: () => dir, getBakinPaths: () => ({ home: dir, db: join(dir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { GIT_FOREGROUND_ARGS, gitArgs } from '../../../packages/core/src/net/git-args'

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('gitArgs', () => {
  it('puts the foreground-only config in front of every invocation, before -C and the subcommand', () => {
    expect(gitArgs(['-C', '/x', 'fetch', 'origin'])).toEqual([...GIT_FOREGROUND_ARGS, '-C', '/x', 'fetch', 'origin'])
    expect(GIT_FOREGROUND_ARGS).toEqual(['-c', 'gc.auto=0', '-c', 'gc.autoDetach=false', '-c', 'maintenance.auto=false'])
  })

  it('git honors it: automatic gc off, no detaching, no background maintenance', () => {
    execFileSync('git', gitArgs(['init', '-q']), { cwd: dir })
    const get = (key: string): string =>
      execFileSync('git', gitArgs(['config', '--get', key]), { cwd: dir, encoding: 'utf-8' }).trim()
    expect(get('gc.auto')).toBe('0')
    expect(get('gc.autoDetach')).toBe('false')
    expect(get('maintenance.auto')).toBe('false')
  })
})
