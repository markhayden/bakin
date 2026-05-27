import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-workflow-availability-${Date.now()}`)
const availabilityFile = join(testDir, 'workflows', 'disabled-defaults.json')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows'), logs: join(testDir, 'logs') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows'), logs: join(testDir, 'logs') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows'), logs: join(testDir, 'logs') }),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
}))

import {
  isWorkflowDisabled,
  readDisabledWorkflowIds,
  resetWorkflowAvailabilityCache,
  setWorkflowDisabled,
} from '@bakin/workflows/lib/availability'

describe('workflow availability storage', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(join(testDir, 'workflows'), { recursive: true })
    resetWorkflowAvailabilityCache()
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    resetWorkflowAvailabilityCache()
  })

  it('returns an empty set when the file does not exist', () => {
    expect(readDisabledWorkflowIds()).toEqual(new Set())
    expect(isWorkflowDisabled('video-social-post')).toBe(false)
  })

  it('writes, sorts, and clears disabled workflow ids', () => {
    setWorkflowDisabled('video-social-post', true)
    setWorkflowDisabled('image-social-post', true)

    expect(readDisabledWorkflowIds()).toEqual(new Set(['image-social-post', 'video-social-post']))
    expect(JSON.parse(readFileSync(availabilityFile, 'utf-8'))).toEqual({
      disabledWorkflowIds: ['image-social-post', 'video-social-post'],
    })

    setWorkflowDisabled('image-social-post', false)

    expect(readDisabledWorkflowIds()).toEqual(new Set(['video-social-post']))
    expect(JSON.parse(readFileSync(availabilityFile, 'utf-8'))).toEqual({
      disabledWorkflowIds: ['video-social-post'],
    })
  })

  it('ignores malformed or schema-invalid JSON without rewriting it', () => {
    writeFileSync(availabilityFile, '{"disabledWorkflowIds":[42]}', 'utf-8')

    expect(readDisabledWorkflowIds()).toEqual(new Set())
    expect(readFileSync(availabilityFile, 'utf-8')).toBe('{"disabledWorkflowIds":[42]}')
  })

  it('caches reads until explicitly reset or a write invalidates the cache', () => {
    writeFileSync(availabilityFile, '{"disabledWorkflowIds":["video-social-post"]}', 'utf-8')
    expect(readDisabledWorkflowIds()).toEqual(new Set(['video-social-post']))

    writeFileSync(availabilityFile, '{"disabledWorkflowIds":["image-social-post"]}', 'utf-8')
    expect(readDisabledWorkflowIds()).toEqual(new Set(['video-social-post']))

    resetWorkflowAvailabilityCache()
    expect(readDisabledWorkflowIds()).toEqual(new Set(['image-social-post']))
  })

  it('rejects contentDir values with parent-directory segments', () => {
    expect(() => readDisabledWorkflowIds(`${testDir}/../other`)).toThrow(/parent-directory/)
    expect(existsSync(join(testDir, '..', 'other', 'workflows', 'disabled-defaults.json'))).toBe(false)
  })
})
