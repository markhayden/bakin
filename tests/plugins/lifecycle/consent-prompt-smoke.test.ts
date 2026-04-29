/**
 * Smoke tests for the consent prompt module (commit C9).
 *
 * Coverage at this commit — render text + accept/reject paths +
 * --yes short-circuit. Full coverage in C10.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { Readable, Writable } from 'stream'

const testDir = join(tmpdir(), `bakin-test-consent-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

import {
  promptInstallConsent,
  promptUpgradeConsent,
  renderInstallPrompt,
  renderUpgradePrompt,
} from '../../../src/core/cli/consent-prompt'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeIO(input: string): {
  io: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream }
  output: () => string
} {
  const stdin = Readable.from([Buffer.from(input)]) as unknown as NodeJS.ReadStream
  let captured = ''
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      captured += chunk.toString('utf-8')
      cb()
    },
  }) as unknown as NodeJS.WriteStream
  return {
    io: { stdin, stdout },
    output: () => captured,
  }
}

describe('renderInstallPrompt', () => {
  it('lists each requested permission with its description', () => {
    const text = renderInstallPrompt({
      pluginId: 'my-plugin',
      version: '1.2.0',
      permissions: ['storage.read', 'events.emit'],
    })
    expect(text).toContain('Installing: my-plugin v1.2.0')
    expect(text).toContain('storage.read')
    expect(text).toContain('Read files in ~/.bakin/')
    expect(text).toContain('events.emit')
    expect(text).toContain('Continue? [y/N]')
  })

  it('shows "(none)" when permissions is empty', () => {
    const text = renderInstallPrompt({ pluginId: 'p', version: '1.0.0', permissions: [] })
    expect(text).toContain('(none)')
  })
})

describe('renderUpgradePrompt', () => {
  it('shows only added permissions with the version diff', () => {
    const text = renderUpgradePrompt({
      pluginId: 'p',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      newPermissions: ['storage.write'],
    })
    expect(text).toContain('Upgrading: p v1.0.0 → v1.1.0')
    expect(text).toContain('NEW permissions requested:')
    expect(text).toContain('+ storage.write')
  })
})

describe('promptInstallConsent', () => {
  it('--yes short-circuits to accepted, no stdout written', async () => {
    const { io, output } = makeIO('')
    const accepted = await promptInstallConsent({
      pluginId: 'p',
      version: '1.0.0',
      permissions: ['storage.read'],
      io,
      yes: true,
    })
    expect(accepted).toBe(true)
    expect(output()).toBe('')
  })

  it('"y\\n" accepts', async () => {
    const { io } = makeIO('y\n')
    expect(await promptInstallConsent({
      pluginId: 'p',
      version: '1.0.0',
      permissions: ['storage.read'],
      io,
    })).toBe(true)
  })

  it('"yes\\n" accepts (common-habit input)', async () => {
    const { io } = makeIO('yes\n')
    expect(await promptInstallConsent({
      pluginId: 'p',
      version: '1.0.0',
      permissions: ['storage.read'],
      io,
    })).toBe(true)
  })

  it('"YES\\n" accepts (case-insensitive)', async () => {
    const { io } = makeIO('YES\n')
    expect(await promptInstallConsent({
      pluginId: 'p',
      version: '1.0.0',
      permissions: ['storage.read'],
      io,
    })).toBe(true)
  })

  it('"n\\n" rejects', async () => {
    const { io } = makeIO('n\n')
    expect(await promptInstallConsent({
      pluginId: 'p',
      version: '1.0.0',
      permissions: ['storage.read'],
      io,
    })).toBe(false)
  })

  it('empty input rejects', async () => {
    const { io } = makeIO('\n')
    expect(await promptInstallConsent({
      pluginId: 'p',
      version: '1.0.0',
      permissions: ['storage.read'],
      io,
    })).toBe(false)
  })
})

describe('promptUpgradeConsent', () => {
  it('returns accepted=true without prompting when newPermissions is empty', async () => {
    const { io, output } = makeIO('')
    const accepted = await promptUpgradeConsent({
      pluginId: 'p',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      newPermissions: [],
      io,
    })
    expect(accepted).toBe(true)
    expect(output()).toBe('')
  })

  it('--yes short-circuits even with new permissions', async () => {
    const { io, output } = makeIO('')
    const accepted = await promptUpgradeConsent({
      pluginId: 'p',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      newPermissions: ['storage.write'],
      io,
      yes: true,
    })
    expect(accepted).toBe(true)
    expect(output()).toBe('')
  })

  it('"y" accepts widening prompt', async () => {
    const { io } = makeIO('y\n')
    expect(await promptUpgradeConsent({
      pluginId: 'p',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      newPermissions: ['storage.write'],
      io,
    })).toBe(true)
  })
})
