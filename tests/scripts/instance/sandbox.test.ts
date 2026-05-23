import { describe, expect, it } from 'bun:test'

import {
  bakinOnboardArgs,
  sandboxBakinArgs,
  sandboxExecArgs,
  sandboxShellArgs,
} from '../../../scripts/instance/sandbox'

const C = '/tmp/fake-repo/dev/docker/docker-compose.yml'

describe('sandboxExecArgs', () => {
  it('execs OpenClaw CLI inside the sandbox container (-T non-interactive)', () => {
    expect(sandboxExecArgs(C, ['mcp', 'set', 'x', '{}'], false)).toEqual([
      'docker', 'compose', '-f', C, 'exec', '-T', 'sandbox', 'node', 'dist/index.js', 'mcp', 'set', 'x', '{}',
    ])
  })
  it('keeps a TTY for interactive (codex OAuth on the published 1455 port)', () => {
    expect(sandboxExecArgs(C, ['models', 'auth', 'login'], true)).toEqual([
      'docker', 'compose', '-f', C, 'exec', '-it', 'sandbox', 'node', 'dist/index.js', 'models', 'auth', 'login',
    ])
  })
})

describe('sandboxBakinArgs', () => {
  it('repo source runs the checkout via bun', () => {
    expect(sandboxBakinArgs(C, 'repo', ['onboard', '--yes'], false)).toEqual([
      'docker', 'compose', '-f', C, 'exec', '-T', 'sandbox', 'bun', 'run', '/bakin/cli/bakin.ts', 'onboard', '--yes',
    ])
  })
  it('installed source runs the bakin binary on PATH', () => {
    expect(sandboxBakinArgs(C, 'installed', ['onboard'], true)).toEqual([
      'docker', 'compose', '-f', C, 'exec', '-it', 'sandbox', 'bakin', 'onboard',
    ])
  })
})

describe('sandboxShellArgs', () => {
  it('opens an interactive shell in the sandbox container', () => {
    expect(sandboxShellArgs(C)).toEqual([
      'docker', 'compose', '-f', C, 'exec', '-it', 'sandbox', 'sh',
    ])
  })
})

describe('bakinOnboardArgs', () => {
  it('is the non-interactive onboard used by --preconfigure', () => {
    expect(bakinOnboardArgs()).toEqual(['onboard', '--yes'])
  })
})
