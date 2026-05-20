import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  materializeCachedGithubSource,
  resetGithubSourceCacheForTests,
} from '../../src/core/github-source-cache'

const testDir = join(tmpdir(), `bakin-test-github-source-cache-${Date.now()}-${randomUUID()}`)

afterAll(() => {
  resetGithubSourceCacheForTests()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  resetGithubSourceCacheForTests()
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

describe('github source cache', () => {
  const isCloneCall = (args: string[]) => args[0] === 'clone'
  const isRevParseCall = (args: string[]) => args[0] === '-C' && args[2] === 'rev-parse'

  it('materializes repeated full-repo requests from one cached checkout', async () => {
    const calls: string[][] = []
    const git = async (args: string[]): Promise<string> => {
      calls.push(args)
      if (isCloneCall(args)) {
        const target = args[args.length - 1]
        mkdirSync(join(target, 'plugins', 'messaging'), { recursive: true })
        mkdirSync(join(target, 'plugins', 'projects'), { recursive: true })
        writeFileSync(join(target, 'plugins', 'messaging', 'bakin-plugin.json'), '{}')
        writeFileSync(join(target, 'plugins', 'projects', 'bakin-plugin.json'), '{}')
        return ''
      }
      if (isRevParseCall(args)) return 'cafebabe\n'
      return ''
    }

    const firstStage = join(testDir, 'stage-one')
    const secondStage = join(testDir, 'stage-two')
    const first = await materializeCachedGithubSource({
      cloneUrl: 'https://github.com/markhayden/bakin-bits-official.git',
      stagingDir: firstStage,
      git,
    })
    const second = await materializeCachedGithubSource({
      cloneUrl: 'https://github.com/markhayden/bakin-bits-official.git',
      stagingDir: secondStage,
      git,
    })

    expect(calls.filter(isCloneCall)).toHaveLength(1)
    expect(first.commitSha).toBe('cafebabe')
    expect(second.commitSha).toBe('cafebabe')
    expect(existsSync(join(firstStage, 'plugins', 'messaging', 'bakin-plugin.json'))).toBe(true)
    expect(existsSync(join(secondStage, 'plugins', 'projects', 'bakin-plugin.json'))).toBe(true)
  })
})
