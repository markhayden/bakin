import { describe, expect, it } from 'bun:test'

import { parseEnvFile, mergeEnv } from '../../../scripts/instance/env-file'

describe('parseEnvFile', () => {
  it('parses KEY=VALUE, skips comments + blanks, strips surrounding quotes', () => {
    const text = [
      '# rig secrets',
      '',
      'OP_SERVICE_ACCOUNT_TOKEN=ops_abc123',
      'OPENCLAW_IMAGE_TAG="2026.5.28"',
      "QUOTED='single'",
      '  # indented comment',
    ].join('\n')
    expect(parseEnvFile(text)).toEqual({
      OP_SERVICE_ACCOUNT_TOKEN: 'ops_abc123',
      OPENCLAW_IMAGE_TAG: '2026.5.28',
      QUOTED: 'single',
    })
  })

  it('ignores malformed lines without throwing (env files are user-edited)', () => {
    expect(parseEnvFile('NOEQUALS\nGOOD=1')).toEqual({ GOOD: '1' })
  })

  it('keeps = inside values', () => {
    expect(parseEnvFile('TOKEN=a=b=c')).toEqual({ TOKEN: 'a=b=c' })
  })
})

describe('mergeEnv', () => {
  it('does not override an already-set process env var', () => {
    const into: Record<string, string | undefined> = { OP_SERVICE_ACCOUNT_TOKEN: 'from-shell' }
    mergeEnv(into, { OP_SERVICE_ACCOUNT_TOKEN: 'from-file', OPENCLAW_IMAGE_TAG: 'x' })
    expect(into.OP_SERVICE_ACCOUNT_TOKEN).toBe('from-shell')
    expect(into.OPENCLAW_IMAGE_TAG).toBe('x')
  })

  it('fills in vars that are unset', () => {
    const into: Record<string, string | undefined> = {}
    mergeEnv(into, { OP_SERVICE_ACCOUNT_TOKEN: 'from-file' })
    expect(into.OP_SERVICE_ACCOUNT_TOKEN).toBe('from-file')
  })
})
