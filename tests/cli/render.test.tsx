import { describe, expect, it } from 'bun:test'

import {
  renderCliResult,
  renderInkEnvelope,
  renderJsonEnvelope,
  renderPlainEnvelope,
  resolveRenderMode,
} from '../../src/core/cli/render'
import { errorResult, okResult, toEnvelope } from '../../src/core/cli/result'

describe('CLI renderers', () => {
  it('renders JSON envelopes without ANSI decoration', () => {
    const output = renderJsonEnvelope(toEnvelope(okResult('status', { running: true })))

    expect(output).toBe('{\n  "ok": true,\n  "command": "status",\n  "exitCode": 0,\n  "data": {\n    "running": true\n  },\n  "error": null\n}\n')
    expect(output).not.toContain('\x1b[')
  })

  it('renders deterministic plain text', () => {
    expect(renderPlainEnvelope(toEnvelope(errorResult('doctor', 'SERVER_UNREACHABLE', 'Cannot reach Bakin')))).toBe(
      '[FAIL] doctor\n\nCannot reach Bakin\nCode: SERVER_UNREACHABLE\n',
    )
  })

  it('renders a generic Ink result view to string', () => {
    const output = renderInkEnvelope(toEnvelope(okResult('version', { version: '1.2.3' })), { color: false })

    expect(output).toContain("┃ 🐷 Bakin'")
    expect(output).toContain('version')
    expect(output).toContain(' OK       0 exit code')
    expect(output).toContain('DATA\n------------')
    expect(output).toContain('"version": "1.2.3"')
    expect(output).not.toContain('[OK]')
  })

  it('renders generic Ink errors with sectioned details', () => {
    const output = renderInkEnvelope(toEnvelope(errorResult('doctor', 'SERVER_UNREACHABLE', 'Cannot reach Bakin')), { color: false })

    expect(output).toContain('Command failed  doctor')
    expect(output).toContain('Cannot reach Bakin')
    expect(output).toContain(' FAIL     1 exit code')
    expect(output).toContain('SERVER_UNREACHABLE code')
    expect(output).toContain('PROBLEM\n------------')
    expect(output).toContain(' FAIL      doctor')
    expect(output).not.toContain('[FAIL]')
  })

  it('selects JSON explicitly and Ink only for TTY output', () => {
    expect(resolveRenderMode({ json: true, stdoutIsTTY: true })).toBe('json')
    expect(resolveRenderMode({ stdoutIsTTY: true })).toBe('ink')
    expect(resolveRenderMode({ stdoutIsTTY: false })).toBe('plain')
  })

  it('renders command results through the selected mode', () => {
    expect(renderCliResult(okResult('status', { ok: true }), { mode: 'plain' })).toBe(
      '[OK] status\n\n{\n  "ok": true\n}\n',
    )
  })
})
