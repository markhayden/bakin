/**
 * Read-only CLI TTY commands — `bakin logs` audit-log rendering. Split from
 * readonly-commands.test.ts (B7).
 *
 * Isolation note: these tests exercise the REAL content-dir resolver against
 * a temp BAKIN_HOME (via withTempBakinHome) because `bakin logs` reads
 * `getBakinPaths().audit` from disk — a content-dir mock.module would defeat
 * what they test. Every test runs inside withTempBakinHome, which points
 * BAKIN_HOME at a fresh temp dir and resets it afterwards, so nothing here
 * can touch the real ~/.bakin. (The mock-checker hook flags this file as a
 * known false positive for the BAKIN_HOME-pattern.)
 */
import { describe, expect, it, spyOn } from 'bun:test'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { setupTtyCliHarness, withTempBakinHome } from './helpers/tty-cli-harness'

const harness = setupTtyCliHarness({ defaultFetchJson: { ok: true } })
const { output, errorOutput, setStdoutIsTTY } = harness

describe('read-only CLI TTY commands — logs', () => {
  it('renders missing audit log failures with the shared TUI when stdout is a TTY', async () => {
    await withTempBakinHome('bakin-cli-missing-audit-', async () => {
      process.argv = ['bun', 'cli/bakin.ts', 'logs']

      const { main } = await import('../../cli/bakin')
      await expect(main()).rejects.toThrow('exit:1')
    })

    expect(output()).toContain('Command failed  bakin logs')
    expect(output()).toContain('AUDIT_LOG_NOT_FOUND')
    expect(output()).toContain('Run `bakin mkdir`')
    expect(errorOutput()).toBe('')
  })

  it('renders audit logs as compact rows in a TTY', async () => {
    await withTempBakinHome('bakin-cli-logs-tty-', async (tempHome) => {
      writeFileSync(join(tempHome, 'audit.jsonl'), [
        JSON.stringify({
          ts: '2026-05-19T19:36:18.405Z',
          event: 'doctor.run',
          agent: 'system',
          channel: null,
          data: { total: 81, errors: 0, warnings: 1 },
        }),
        JSON.stringify({
          ts: '2026-05-19T19:36:23.900Z',
          event: 'system.shutdown',
          agent: 'system',
          channel: null,
          data: { signal: 'SIGINT' },
        }),
      ].join('\n'))
      process.argv = ['bun', 'cli/bakin.ts', 'logs', '--no-follow']

      const { main } = await import('../../cli/bakin')
      await main()
    })

    expect(output()).toContain("┃ 🐷 Bakin'")
    expect(output()).toContain('Logs  filter: all')
    expect(output()).toContain('RECENT EVENTS')
    expect(output()).toContain('doctor.run')
    expect(output()).toContain('total=81 errors=0 warnings=1')
    expect(output()).not.toContain('{\n  "ts"')
    expect(errorOutput()).toBe('')
  })

  it('emits newline-delimited JSON for audit logs with --json', async () => {
    await withTempBakinHome('bakin-cli-logs-json-', async (tempHome) => {
      writeFileSync(join(tempHome, 'audit.jsonl'), [
        JSON.stringify({
          ts: '2026-05-19T19:36:18.405Z',
          event: 'doctor.run',
          agent: 'system',
          channel: null,
          data: { total: 81 },
        }),
        JSON.stringify({
          ts: '2026-05-19T19:36:46.301Z',
          event: 'plugin.activate',
          agent: 'system',
          channel: 'system',
          data: { pluginId: 'team' },
        }),
      ].join('\n'))
      process.argv = ['bun', 'cli/bakin.ts', 'logs', '--json', '--no-follow']

      const { main } = await import('../../cli/bakin')
      await main()
    })

    expect(output()).toContain('{"ts":"2026-05-19T19:36:18.405Z","event":"doctor.run"')
    expect(output()).toContain('{"ts":"2026-05-19T19:36:46.301Z","event":"plugin.activate"')
    expect(output()).not.toContain('Tailing')
    expect(output()).not.toContain('filter: --json')
    expect(errorOutput()).toBe('')
  })

  it('defaults audit logs to newline-delimited JSON outside TTY', async () => {
    setStdoutIsTTY(false)
    await withTempBakinHome('bakin-cli-logs-pipe-', async (tempHome) => {
      writeFileSync(join(tempHome, 'audit.jsonl'), JSON.stringify({
        ts: '2026-05-19T19:36:18.405Z',
        event: 'doctor.run',
        agent: 'system',
        channel: null,
        data: { total: 81 },
      }))
      process.argv = ['bun', 'cli/bakin.ts', 'logs', '--no-follow']

      const { main } = await import('../../cli/bakin')
      await main()
    })

    expect(output()).toBe('{"ts":"2026-05-19T19:36:18.405Z","event":"doctor.run","agent":"system","channel":null,"data":{"total":81}}')
    expect(errorOutput()).toBe('')
  })

  it('prints only the last N entries without reading the whole audit log', async () => {
    const fs = await import('fs')
    let auditReads = 0
    await withTempBakinHome('bakin-cli-logs-tail-', async (tempHome) => {
      const lines: string[] = []
      for (let i = 0; i < 5000; i++) {
        lines.push(JSON.stringify({ ts: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(), event: 'doctor.run', agent: 'system', data: { i } }))
      }
      writeFileSync(join(tempHome, 'audit.jsonl'), lines.join('\n') + '\n')
      process.argv = ['bun', 'cli/bakin.ts', 'logs', '--json', '--no-follow', '--lines', '3']

      const readFileSpy = spyOn(fs, 'readFileSync')
      try {
        const { main } = await import('../../cli/bakin')
        await main()
        auditReads = readFileSpy.mock.calls.filter((c) => String(c[0]).endsWith('audit.jsonl')).length
      } finally {
        readFileSpy.mockRestore()
      }
    })

    expect(auditReads).toBe(0)
    const printed = output().trim().split('\n').map((l) => (JSON.parse(l) as { data: { i: number } }).data.i)
    expect(printed).toEqual([4997, 4998, 4999])
    expect(errorOutput()).toBe('')
  })
})
