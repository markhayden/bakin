/**
 * The app's process registry (#895): `operation.updated` in the plugin-event
 * envelope — milestones through the replayable broadcast, ticks through the
 * ephemeral one — one audit record per finished operation (channel from
 * origin), and the shutdown note.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-operations-app-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import {
  _resetOperationRegistryForTests,
  getOperationRegistry,
  noteOperationsShutdown,
  OPERATION_UPDATED_EVENT,
  runLocal,
} from '../../../src/core/operations'
import { getBootId } from '../../../src/core/boot-id'
import type { OperationView } from '@bakin/core/operations'
import { waitUntil } from '../../helpers/wait'

type Sent = { channel: 'replay' | 'ephemeral'; data: Record<string, unknown> }
const g = globalThis as { __bakinBroadcast?: unknown; __bakinBroadcastEphemeral?: unknown }
const saved = { replay: g.__bakinBroadcast, ephemeral: g.__bakinBroadcastEphemeral }
let sent: Sent[] = []

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  sent = []
  g.__bakinBroadcast = (data: Record<string, unknown>) => sent.push({ channel: 'replay', data })
  g.__bakinBroadcastEphemeral = (data: Record<string, unknown>) => sent.push({ channel: 'ephemeral', data })
  _resetOperationRegistryForTests()
})
afterEach(() => _resetOperationRegistryForTests())
afterAll(() => {
  g.__bakinBroadcast = saved.replay
  g.__bakinBroadcastEphemeral = saved.ephemeral
  rmSync(testDir, { recursive: true, force: true })
})

const plan = { stages: [{ id: 'download', kind: 'downloading' as const, label: 'Download' }], pointOfNoReturn: null }

describe('app operations registry', () => {
  it('is one registry per process, stamped with the boot id', () => {
    expect(getOperationRegistry()).toBe(getOperationRegistry())
  })

  it('sends milestones on the replayable channel and ticks on the ephemeral one, in the plugin-event envelope', async () => {
    const view = await runLocal({
      kind: 'install', owner: 'core', origin: 'cli', title: 'Install media', fingerprint: 'media', plan,
      run: async (op) => {
        op.stage('download')
        op.bytes('download', { received: 5, total: 10 })
        // A tick is coalesced into the throttle window; hold the run open until it lands.
        await waitUntil(() => sent.some((s) => s.channel === 'ephemeral'), { label: 'tick sent' })
        return { status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true } }
      },
    })
    expect(view.bootId).toBe(getBootId())
    await waitUntil(() => sent.some((s) => (s.data.view as OperationView).status === 'succeeded'), { label: 'terminal sent' })

    for (const { data } of sent) {
      expect(data).toMatchObject({ type: 'plugin-event', event: OPERATION_UPDATED_EVENT, timestamp: expect.any(String) })
      expect((data.view as OperationView).id).toBe(view.id)
    }
    expect(sent.filter((s) => s.channel === 'replay').map((s) => (s.data.view as OperationView).status)).toContain('succeeded')
    expect(sent.some((s) => s.channel === 'ephemeral' && (s.data.view as OperationView).stages[0].bytes?.received === 5)).toBe(true)
  })

  it('appends one audit record with the channel derived from origin', async () => {
    await runLocal({
      kind: 'install', owner: 'core', origin: 'cli', title: 'Install media', fingerprint: 'media-audit', plan,
      run: async () => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: null }),
    })
    const auditFile = join(testDir, 'audit.jsonl')
    expect(existsSync(auditFile)).toBe(true)
    const records = readFileSync(auditFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
    expect(records).toEqual([expect.objectContaining({ event: 'operation.succeeded', agent: 'system', channel: 'cli', data: expect.objectContaining({ kind: 'install', origin: 'cli', code: 'ok' }) })])
  })

  it('notes the shutdown in live operations and is a no-op before any registry exists', async () => {
    noteOperationsShutdown()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const { operationId } = await getOperationRegistry().start({
      kind: 'install', owner: 'core', origin: 'web', title: 'Long', fingerprint: 'long', plan,
      run: async () => { await gate; return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null } },
    })
    noteOperationsShutdown()
    expect(getOperationRegistry().get(operationId)!.log.at(-1)?.text).toBe('Server stopping')
    release()
    await getOperationRegistry().await(operationId)
  })
})
