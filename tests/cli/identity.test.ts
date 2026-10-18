/**
 * CLI identity headers (#898 D-H4): every request from one invocation
 * carries the same identity; the operator declaration rides only `--as human`.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { cliIdentityHeaders, resetCliIdentityForTests } from '../../src/cli/identity'

afterEach(() => resetCliIdentityForTests())

describe('cliIdentityHeaders', () => {
  it('--as human (either spelling, anywhere on the line) declares the operator', () => {
    expect(cliIdentityHeaders(['doctor', '--fix', '--as', 'human'])).toEqual({ 'X-Bakin-Operator': 'declared' })
    resetCliIdentityForTests()
    expect(cliIdentityHeaders(['--as=human', 'doctor', '--fix'])).toEqual({ 'X-Bakin-Operator': 'declared' })
  })

  it('no flag, an agent, or a malformed flag declares nothing', () => {
    for (const argv of [['doctor', '--fix'], ['tasks', 'move', 't', 'done', '--as', 'researcher'], ['doctor', '--as']]) {
      resetCliIdentityForTests()
      expect(cliIdentityHeaders(argv)).toEqual({})
    }
  })
})
