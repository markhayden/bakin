/**
 * In-process follow (#895 D11): updates render from this process's registry
 * with no server, and Ctrl-C once cancels and waits for the settle (or says
 * it can't stop now), twice force-exits.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-component-install-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import type { OperationView } from '@makinbakin/sdk/types'
import { followLocalAndRender } from '../../src/cli/component-install'
import type { OperationRenderer } from '../../src/cli/operation-renderer'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { waitUntil } from '../helpers/wait'

function recordingRenderer() {
  const updates: OperationView[] = []
  const notes: string[] = []
  const renderer: OperationRenderer = { update: (view) => { updates.push(view) }, note: (text) => { notes.push(text) }, finish: () => {} }
  return { renderer, updates, notes }
}

function signals() {
  const emitter = new EventEmitter()
  return { on: emitter.on.bind(emitter), off: emitter.off.bind(emitter), press: () => emitter.emit('SIGINT') } as unknown as Pick<NodeJS.Process, 'on' | 'off'> & { press: () => void }
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  _resetOperationRegistryForTests()
})
afterEach(() => _resetOperationRegistryForTests())
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

/** A cancellable download that waits for cancel, then settles. */
async function startDownload(pointOfNoReturn: string | null) {
  return getOperationRegistry().start({
    kind: 'onboarding:test', owner: 'core', origin: 'cli', title: 'Download the thing', fingerprint: `t:${randomUUID()}`,
    resources: [],
    plan: { stages: [{ id: 'download', kind: 'downloading', label: 'Download' }, { id: 'commit', kind: 'committing', label: 'Commit' }], pointOfNoReturn },
    run: async (op) => {
      op.stage('download')
      if (pointOfNoReturn === 'download') {
        await new Promise((r) => setTimeout(r, 30))
        return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null }
      }
      await new Promise<void>((resolve) => op.signal.addEventListener('abort', () => resolve(), { once: true }))
      op.throwIfCancelled()
      return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null }
    },
  })
}

describe('followLocalAndRender', () => {
  it('renders local updates, and Ctrl-C once cancels and waits for the settle', async () => {
    const { operationId } = await startDownload(null)
    const { renderer, updates, notes } = recordingRenderer()
    const sig = signals()
    const following = followLocalAndRender(operationId, { renderer, signals: sig })
    await waitUntil(() => updates.some((v) => v.stages[0]?.status === 'active'), { label: 'the download renders' })

    sig.press()
    const result = await following
    expect(result.operation?.status).toBe('cancelled')
    expect(notes[0]).toContain('Cancelling')
  })

  it("past the point of no return Ctrl-C says it can't stop now and the run finishes", async () => {
    const { operationId } = await startDownload('download')
    const { renderer, updates, notes } = recordingRenderer()
    const sig = signals()
    const following = followLocalAndRender(operationId, { renderer, signals: sig })
    await waitUntil(() => updates.some((v) => v.stages[0]?.status === 'active'), { label: 'the download renders' })

    sig.press()
    expect(notes[0]).toContain("Can't stop now")
    expect((await following).operation?.status).toBe('succeeded')
  })

  it('a second Ctrl-C force-exits with 130 and says the next start checks interrupted installs', async () => {
    const { operationId } = await startDownload('download')
    const { renderer, notes } = recordingRenderer()
    const sig = signals()
    const exits: number[] = []
    const following = followLocalAndRender(operationId, { renderer, signals: sig, exit: ((code: number) => { exits.push(code) }) as never })
    await waitUntil(() => getOperationRegistry().get(operationId)?.stages[0]?.status === 'active', { label: 'running' })
    sig.press()
    sig.press()
    expect(exits).toEqual([130])
    expect(notes.at(-1)).toContain('next start checks')
    await following
  })
})
