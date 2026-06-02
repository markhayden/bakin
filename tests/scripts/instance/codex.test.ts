import { describe, expect, it } from 'bun:test'

import {
  CODEX_CLI_ENTRY,
  CODEX_DEFAULT_MODEL,
  CODEX_HOME_CONTAINER,
  codexAuthFile,
  codexLoginArgs,
} from '../../../scripts/instance/codex'

describe('codexLoginArgs', () => {
  it('uses the device-code flow (browser callback hangs behind the container loopback)', () => {
    expect(codexLoginArgs()).toEqual(['login', '--device-auth'])
  })
})

describe('codexAuthFile', () => {
  it('points at CODEX_HOME/auth.json under the mounted home (presence == authed)', () => {
    expect(codexAuthFile('/tmp/fake-repo/dev/openclaw-home')).toBe(
      '/tmp/fake-repo/dev/openclaw-home/codex/auth.json',
    )
  })

  it('keeps CODEX_HOME inside the mounted ~/.openclaw volume so it persists', () => {
    expect(CODEX_HOME_CONTAINER).toBe('/home/node/.openclaw/codex')
    expect(CODEX_CLI_ENTRY).toContain('@openai/codex')
    expect(CODEX_DEFAULT_MODEL).toBe('openai/gpt-5.5')
  })
})
