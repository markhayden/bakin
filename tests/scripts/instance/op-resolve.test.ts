import { describe, expect, it } from 'bun:test'

import type { CommandRunner, RunResult } from '../../../scripts/instance/runner'
import {
  parseSecretsTemplate,
  redactSecrets,
  resolveSecrets,
} from '../../../scripts/instance/op-resolve'

/** Fake runner: maps `op read <ref>` to a canned value, or a failure. */
function fakeOp(values: Record<string, string>, failRefs: string[] = []): {
  runner: CommandRunner
  calls: string[][]
} {
  const calls: string[][] = []
  const runner: CommandRunner = {
    async run(argv): Promise<RunResult> {
      calls.push(argv)
      const ref = argv[argv.length - 1]
      if (failRefs.includes(ref)) {
        return { code: 1, stdout: '', stderr: `[ERROR] could not read ${ref}: not found` }
      }
      return { code: 0, stdout: `${values[ref] ?? ''}\n`, stderr: '' }
    },
  }
  return { runner, calls }
}

describe('parseSecretsTemplate', () => {
  it('parses KEY=op:// lines and skips comments + blanks', () => {
    const text = [
      '# OpenClaw secrets',
      '',
      'BRAVE_API_KEY=op://Vault/brave-search/credential',
      '   # indented comment',
      'OPENAI_API_KEY=op://Vault/openai/credential',
    ].join('\n')
    expect(parseSecretsTemplate(text)).toEqual([
      { key: 'BRAVE_API_KEY', ref: 'op://Vault/brave-search/credential' },
      { key: 'OPENAI_API_KEY', ref: 'op://Vault/openai/credential' },
    ])
  })

  it('rejects a line without an = assignment', () => {
    expect(() => parseSecretsTemplate('BRAVE_API_KEY op://x')).toThrow(/KEY=op:\/\//)
  })

  it('rejects a non-op:// value', () => {
    expect(() => parseSecretsTemplate('BRAVE_API_KEY=plain-secret')).toThrow(/op:\/\//)
  })

  it('rejects a malformed env key', () => {
    expect(() => parseSecretsTemplate('not a key=op://Vault/x/y')).toThrow(/key/i)
  })
})

describe('resolveSecrets', () => {
  it('resolves each ref via `op read` and returns a key→value map', async () => {
    const { runner, calls } = fakeOp({
      'op://Vault/brave-search/credential': 'brave-xyz',
    })
    const out = await resolveSecrets(
      [{ key: 'BRAVE_API_KEY', ref: 'op://Vault/brave-search/credential' }],
      runner,
    )
    expect(out).toEqual({ BRAVE_API_KEY: 'brave-xyz' })
    expect(calls).toEqual([['op', 'read', 'op://Vault/brave-search/credential']])
  })

  it('throws an actionable error naming the key when op cannot resolve a ref', async () => {
    const { runner } = fakeOp({}, ['op://Vault/missing/credential'])
    await expect(
      resolveSecrets([{ key: 'BRAVE_API_KEY', ref: 'op://Vault/missing/credential' }], runner),
    ).rejects.toThrow(/BRAVE_API_KEY/)
  })
})

describe('redactSecrets', () => {
  it('masks every resolved value found in a line', () => {
    expect(redactSecrets('using key brave-xyz now', ['brave-xyz'])).toBe('using key *** now')
  })

  it('ignores empty secrets so it never masks the whole line', () => {
    expect(redactSecrets('nothing secret here', ['', '   '])).toBe('nothing secret here')
  })
})
