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

import { GIT_FOREGROUND_ARGS, gitArgs, gitFailureMessage } from '../../../packages/core/src/net/git-args'

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

describe('gitFailureMessage', () => {
  it('keeps what git said went wrong and drops the clone progress and its temp path', () => {
    const stderr = "Cloning into '/private/var/folders/l8/T/bakin-github-source-cache-K95Hdl/87ec110f-0b8b'...\nfatal: transport 'https' not allowed\n"
    expect(gitFailureMessage(stderr, 'git clone failed')).toBe("transport 'https' not allowed")
  })

  it('joins several fatal/error lines and leaves remote chatter out', () => {
    const stderr = 'remote: Repository not found.\nerror: could not lock config file\nfatal: repository \'https://github.com/x/y.git/\' not found\n'
    expect(gitFailureMessage(stderr, 'x')).toBe("could not lock config file; repository 'https://github.com/x/y.git/' not found")
  })

  it('falls back to the last line git wrote, then to the caller\'s words', () => {
    expect(gitFailureMessage('warning: something\nsomething else broke\n', 'x')).toBe('something else broke')
    expect(gitFailureMessage('  \n', 'git clone exited with code 128')).toBe('git clone exited with code 128')
  })

  it('a real failed clone reads as one sentence', () => {
    let message = ''
    try {
      execFileSync('git', gitArgs(['clone', join(dir, 'no-such-repo'), join(dir, 'out')]), { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      message = gitFailureMessage(String((err as { stderr: Buffer }).stderr), 'failed')
    }
    expect(message).toContain('does not exist')
    expect(message).not.toContain('Cloning into')
    expect(message).not.toContain('\n')
  })
})
