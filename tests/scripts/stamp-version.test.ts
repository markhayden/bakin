import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  RELEASE_TAG_RE,
  resolveVersion,
  stripReleaseTag,
  writeGeneratedVersion,
  type GitResult,
} from '../../scripts/stamp-version'

const testRoot = join(tmpdir(), `bakin-test-stamp-version-${Date.now()}`)

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

function gitWith(results: GitResult[]): (args: string[]) => GitResult {
  let index = 0
  return () => {
    const result = results[index]
    index += 1
    return result ?? { status: 1, stdout: '' }
  }
}

describe('release tag parsing', () => {
  it('accepts stable and rc tags only', () => {
    expect(RELEASE_TAG_RE.test('v0.1.0')).toBe(true)
    expect(RELEASE_TAG_RE.test('v1.2.3-rc.4')).toBe(true)
    expect(RELEASE_TAG_RE.test('v1.2.3-dev.1')).toBe(false)
    expect(RELEASE_TAG_RE.test('search-checkpoint-5')).toBe(false)
  })

  it('strips the leading refs/tags/v prefix', () => {
    expect(stripReleaseTag('refs/tags/v0.2.0')).toBe('0.2.0')
    expect(stripReleaseTag('v0.2.0-rc.1')).toBe('0.2.0-rc.1')
  })
})

describe('resolveVersion', () => {
  it('prefers GITHUB_REF release tags', () => {
    const version = resolveVersion({
      env: { GITHUB_REF: 'refs/tags/v0.2.0-rc.1' },
      git: () => {
        throw new Error('git should not be called')
      },
    })
    expect(version).toBe('0.2.0-rc.1')
  })

  it('rejects malformed v-prefixed GitHub refs', () => {
    expect(() => resolveVersion({
      env: { GITHUB_REF: 'refs/tags/v0.2.0-dev.1' },
      git: () => ({ status: 1, stdout: '' }),
    })).toThrow('Malformed release tag')
  })

  it('uses exact release tags before nearest describe output', () => {
    const calls: string[][] = []
    const version = resolveVersion({
      env: {},
      git: (args) => {
        calls.push(args)
        return args.includes('--exact-match')
          ? { status: 0, stdout: 'v0.3.0\n' }
          : { status: 0, stdout: 'v0.2.0-4-gabc1234\n' }
      },
    })

    expect(version).toBe('0.3.0')
    expect(calls[0]).toEqual(['describe', '--tags', '--exact-match', '--match', 'v[0-9]*'])
  })

  it('returns non-publishable nearest describe versions for local dev', () => {
    const version = resolveVersion({
      env: {},
      git: gitWith([
        { status: 1, stdout: '' },
        { status: 0, stdout: 'v0.3.0-4-gabc1234-dirty\n' },
      ]),
    })

    expect(version).toBe('0.3.0-4-gabc1234-dirty')
  })

  it('ignores non-release tags found by git describe', () => {
    const version = resolveVersion({
      env: {},
      git: gitWith([
        { status: 0, stdout: 'v0.3.0-dev.1\n' },
        { status: 0, stdout: 'v0.2.0-dev.1-4-gabc1234\n' },
      ]),
    })

    expect(version).toBe('0.0.0-dev')
  })

  it('falls back to 0.0.0-dev when no tag is available', () => {
    const version = resolveVersion({
      env: {},
      git: () => ({ status: 1, stdout: '' }),
    })

    expect(version).toBe('0.0.0-dev')
  })
})

describe('writeGeneratedVersion', () => {
  it('writes the generated version file and no-ops when unchanged', () => {
    const dir = join(testRoot, 'generated')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'generated-version.ts')

    expect(existsSync(path)).toBe(false)
    expect(writeGeneratedVersion(path, '0.4.0')).toBe(true)
    expect(readFileSync(path, 'utf-8')).toBe("export const APP_VERSION = '0.4.0'\n")
    expect(writeGeneratedVersion(path, '0.4.0')).toBe(false)
  })
})
