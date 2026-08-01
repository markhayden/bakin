/**
 * Engine-status probe — pure parsers + the stateful probe with a fake io.
 * No real launchctl/ps ever runs; the log scan uses a temp file.
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync, mkdirSync, writeFileSync, appendFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-antfly-engine-status-${Date.now()}-${randomUUID()}`)
process.env.ANTFLY_HOME = join(testDir, 'antfly-home')

import { describe, it, expect, afterAll, mock } from 'bun:test'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { createEngineStatusProbe, parsePsCpuTime, scanLogDelta } from '../../packages/adapter-antfly/src/engine-status'
import { servicePaths, type ServiceIo } from '../../packages/adapter-antfly/src/service'
import { DEFAULT_SETTINGS } from '../../packages/adapter-antfly/src/defaults'
import { settleFor } from '../helpers/wait'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('parsePsCpuTime', () => {
  it('parses mm:ss, hh:mm:ss, and dd-hh:mm:ss', () => {
    expect(parsePsCpuTime('0:07.12')).toBeCloseTo(7.12)
    expect(parsePsCpuTime('14:54.63')).toBeCloseTo(894.63)
    expect(parsePsCpuTime('2:30:00')).toBe(9000)
    expect(parsePsCpuTime('1-01:00:00')).toBe(90000)
  })

  it('rejects garbage', () => {
    expect(parsePsCpuTime('')).toBeNull()
    expect(parsePsCpuTime('not-a-time')).toBeNull()
  })
})

describe('scanLogDelta', () => {
  const logDir = join(testDir, 'scan-logs')
  const logFile = (name: string) => join(logDir, name)

  it('null offset = first probe — baselines to EOF without firing on history', () => {
    mkdirSync(logDir, { recursive: true })
    const file = logFile('history.log')
    writeFileSync(file, 'catch-up debt persists\n'.repeat(50))
    const first = scanLogDelta(file, null)
    expect(first.signals).toEqual([])
    expect(first.nextOffset).toBeGreaterThan(0)
  })

  it('fires only when the signature recurs in the NEW bytes', () => {
    const file = logFile('delta.log')
    writeFileSync(file, 'boot ok\n')
    const base = scanLogDelta(file, null)

    appendFileSync(file, 'catch-up debt persists\n') // once = noise
    const once = scanLogDelta(file, base.nextOffset)
    expect(once.signals).toEqual([])

    appendFileSync(file, 'catch-up debt persists\n'.repeat(5)) // loop = wedge
    const loop = scanLogDelta(file, once.nextOffset)
    expect(loop.signals).toEqual(['startup-catchup-spin'])

    // Offset advanced — the same lines never fire twice.
    const after = scanLogDelta(file, loop.nextOffset)
    expect(after.signals).toEqual([])
  })

  it('SendFailed fires only as a STORM — a benign disconnect burst stays quiet', () => {
    const file = logFile('sendfailed.log')
    writeFileSync(file, 'boot ok\n')
    const base = scanLogDelta(file, null)

    // A client dropping mid-restart: a handful of lines, not a wedge.
    appendFileSync(file, 'Connection error: error.SendFailed\n'.repeat(10))
    const burst = scanLogDelta(file, base.nextOffset)
    expect(burst.signals).toEqual([])

    // The 2026-07-14 wedge shape: sustained spam within one window.
    appendFileSync(file, 'Connection error: error.SendFailed\n'.repeat(60))
    const storm = scanLogDelta(file, burst.nextOffset)
    expect(storm.signals).toEqual(['connection-send-failed-storm'])
  })

  it('TableReadChurn fires past its floor', () => {
    const file = logFile('readchurn.log')
    writeFileSync(file, 'boot ok\n')
    const base = scanLogDelta(file, null)

    appendFileSync(file, 'Route handler error: error.TableReadChurn\n'.repeat(3))
    expect(scanLogDelta(file, base.nextOffset).signals).toEqual([])

    appendFileSync(file, 'Route handler error: error.TableReadChurn\n'.repeat(12))
    const churn = scanLogDelta(file, base.nextOffset)
    expect(churn.signals).toEqual(['table-read-churn'])
  })

  it('handles rotation (file shrank) without throwing or double-firing history', () => {
    const file = logFile('rotated.log')
    writeFileSync(file, 'x'.repeat(10_000))
    const base = scanLogDelta(file, null)
    writeFileSync(file, 'fresh after rotation\n') // truncated below the old offset
    const scan = scanLogDelta(file, base.nextOffset)
    expect(scan.signals).toEqual([])
    expect(scan.nextOffset).toBe('fresh after rotation\n'.length)
  })

  it('missing log = no signals, offset 0', () => {
    expect(scanLogDelta(logFile('never-written.log'), null)).toEqual({ signals: [], nextOffset: 0 })
  })
})

describe('createEngineStatusProbe', () => {
  function fakeIo(psTimes: string[], pid = 4242): ServiceIo & { record: string[][] } {
    const record: string[][] = []
    let psCall = 0
    return {
      platform: 'darwin',
      hasCommand: () => true,
      env: { HOME: testDir },
      exec: async (cmd, args) => {
        record.push([cmd, ...args])
        if (cmd === 'launchctl') return { code: 0, stdout: `state = running\n\tpid = ${pid}\n`, stderr: '' }
        if (cmd === 'ps') return { code: 0, stdout: psTimes[Math.min(psCall++, psTimes.length - 1)], stderr: '' }
        return { code: 1, stdout: '', stderr: 'unexpected' }
      },
      record,
    }
  }

  it('first sample has null utilization; the second reports the rate since the first', async () => {
    mkdirSync(join(testDir, 'logs'), { recursive: true })
    writeFileSync(servicePaths().logFile, '')
    // 60 CPU-seconds between samples → utilization = 60 / wallSeconds; with
    // wall << 60s in-test this just needs to be a positive finite number.
    const probe = createEngineStatusProbe(() => DEFAULT_SETTINGS, fakeIo(['1:00.00', '2:00.00']))
    const first = await probe()
    expect(first).not.toBeNull()
    expect(first!.running).toBe(true)
    expect(first!.pid).toBe(4242)
    expect(first!.cpuUtilization).toBeNull()

    // CPU utilization is sampled BETWEEN probes, so real elapsed time is the
    // input under test — there is no condition that could be polled instead.
    await settleFor(20, 'let real time elapse between probes so CPU utilization can be sampled')
    const second = await probe()
    expect(second!.cpuUtilization).toBeGreaterThan(0)
    expect(Number.isFinite(second!.cpuUtilization!)).toBe(true)
  })

  it('reports running=false when the supervisor has no pid', async () => {
    const io: ServiceIo = {
      platform: 'darwin',
      hasCommand: () => true,
      env: { HOME: testDir },
      exec: async () => ({ code: 113, stdout: '', stderr: 'not loaded' }),
    }
    const probe = createEngineStatusProbe(() => DEFAULT_SETTINGS, io)
    const status = await probe()
    expect(status).toEqual({ running: false, cpuUtilization: null, wedgeSignals: [] })
  })

  it('guest mode cannot measure — resolves null', async () => {
    const probe = createEngineStatusProbe(
      () => ({ ...DEFAULT_SETTINGS, url: 'http://other:1234' }),
      { platform: 'darwin', hasCommand: () => true, env: { HOME: testDir }, exec: async () => ({ code: 0, stdout: '', stderr: '' }) },
    )
    expect(await probe()).toBeNull()
  })

  it('surfaces wedge signals from the engine log delta', async () => {
    mkdirSync(join(testDir, 'logs'), { recursive: true })
    writeFileSync(servicePaths().logFile, 'old history\n')
    const probe = createEngineStatusProbe(() => DEFAULT_SETTINGS, fakeIo(['1:00.00', '1:30.00']))
    const first = await probe() // baseline — history never fires
    expect(first!.wedgeSignals).toEqual([])

    appendFileSync(servicePaths().logFile, 'catch-up debt persists\n'.repeat(10))
    const second = await probe()
    expect(second!.wedgeSignals).toEqual(['startup-catchup-spin'])
  })
})
