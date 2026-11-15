/**
 * bakin_exec_ask_user (projects revamp D1/D6): validates, parks the question
 * in the registry, and returns a SHORT token result that survives Pi's
 * one-line summary and OpenClaw's 500-char preview clip.
 */
import { describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ask-user-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import '../../../src/core/exec-tools/tools/ask-user'
import { getExecTool } from '../../../src/core/exec-tools/registry'
import { parseBakinQuestion } from '../../../packages/core/src/conversation/questions'

const tool = () => {
  const found = getExecTool('bakin_exec_ask_user')
  if (!found) throw new Error('bakin_exec_ask_user is not registered')
  return found
}

const args = {
  question: 'Which inbox are we cleaning?',
  options: [{ label: 'Personal Gmail', description: 'Fastest win.' }, { label: 'Personal and work' }],
  recommended: 0,
}

describe('bakin_exec_ask_user', () => {
  test('is registered as a core tool with a runtime-convertible schema', () => {
    expect(tool().source).toBe('core')
    // Pi's in-process provider converts every tool's parameters to JSON Schema.
    expect(() => z.toJSONSchema(z.object(tool().parameters), { io: 'input' })).not.toThrow()
  })

  test('returns a short message and the minted question for the host to carry', async () => {
    const result = await tool().handler(args, 'roscoe')
    expect(result.ok).toBe(true)
    expect(String(result.message).length).toBeLessThan(200)
    const question = parseBakinQuestion(result.question)
    expect(question).toMatchObject({ v: 1, question: args.question, recommended: 0, allowOther: true })
    expect(question?.options).toHaveLength(2)
  })

  test('invalid questions fail with the cap that was broken', async () => {
    const result = await tool().handler({ ...args, options: [{ label: 'Only one' }] }, 'roscoe')
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('options')
  })
})
