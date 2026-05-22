import { describe, expect, it } from 'bun:test'

import type { RunResult } from '../../../scripts/instance/runner'
import {
  codexLoginArgs,
  ensureCodexAuth,
  hasCodexProfile,
  type OpenClawExec,
} from '../../../scripts/instance/codex'

function fakeExec(handlers: { list: RunResult; login?: RunResult }): {
  exec: OpenClawExec
  calls: { args: string[]; interactive?: boolean }[]
} {
  const calls: { args: string[]; interactive?: boolean }[] = []
  const exec: OpenClawExec = async (args, opts) => {
    calls.push({ args, interactive: opts?.interactive })
    if (args.join(' ').startsWith('models auth list')) return handlers.list
    if (args.join(' ').startsWith('models auth login')) {
      return handlers.login ?? { code: 0, stdout: 'logged in', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { exec, calls }
}

describe('codexLoginArgs', () => {
  it('uses the codex provider and the provider default model (no hardcoded model id)', () => {
    expect(codexLoginArgs()).toEqual([
      'models', 'auth', 'login', '--provider', 'openai-codex', '--set-default',
    ])
  })
})

describe('hasCodexProfile', () => {
  it('detects an existing openai-codex profile', () => {
    expect(hasCodexProfile('openai-codex (oauth)  default')).toBe(true)
  })
  it('returns false when only other providers are present', () => {
    expect(hasCodexProfile('anthropic (api_key)')).toBe(false)
    expect(hasCodexProfile('')).toBe(false)
  })
})

describe('ensureCodexAuth', () => {
  it('skips the browser flow when a codex profile already exists', async () => {
    const { exec, calls } = fakeExec({ list: { code: 0, stdout: 'openai-codex (oauth)', stderr: '' } })
    const result = await ensureCodexAuth(exec)
    expect(result).toEqual({ alreadyAuthed: true })
    expect(calls.some((c) => c.args.join(' ').includes('login'))).toBe(false)
  })

  it('runs the interactive browser OAuth flow when no codex profile exists', async () => {
    const { exec, calls } = fakeExec({ list: { code: 0, stdout: 'anthropic (api_key)', stderr: '' } })
    const result = await ensureCodexAuth(exec)
    expect(result).toEqual({ alreadyAuthed: false })
    const login = calls.find((c) => c.args.join(' ').includes('login'))
    expect(login).toBeDefined()
    expect(login!.interactive).toBe(true)
  })

  it('throws when the login flow fails', async () => {
    const { exec } = fakeExec({
      list: { code: 0, stdout: '', stderr: '' },
      login: { code: 1, stdout: '', stderr: 'oauth aborted' },
    })
    await expect(ensureCodexAuth(exec)).rejects.toThrow(/codex/i)
  })
})
