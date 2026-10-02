/**
 * /api/approvals host routes (plan PR 2 T4): list pending (default) with
 * taskIds filter; resolve with the web actor; typed errors map to 404/409/
 * handler status; bad input is 400.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-approvals-api-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ approvals: { channelAlerts: false, channel: 'general', requireRejectReason: true } }),
  resetSettingsCache: () => {},
}))
mock.module('../../src/core/sse', () => ({ broadcast: () => {} }))
mock.module('../../src/core/app-services-store', () => ({ maybeGetAppServices: () => undefined, getAppServices: () => { throw new Error('no services') } }))

import { get, resolve, approvalIdFromPath } from '../../packages/host/src/api/approvals'
import { requestApproval } from '../../src/core/approvals/service'
import { registerApprovalKind, clearApprovalKinds } from '../../src/core/approvals/kinds'
import { ApprovalResolveError } from '../../src/core/approvals/errors'
import { getApprovalRecord } from '../../packages/core/src/approvals'

const owner = (taskId: string) => ({ kind: 'workflow-gate' as const, taskId, workflowId: 'publish', runId: 'inst', stepId: 'review' })
const request = { title: 'Gate', body: '', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }] }
const onResolve = mock(async (_record: unknown, _decision: unknown) => {})

const GET = (query = '') => get(new Request(`http://bakin.test/api/approvals${query}`), new URL(`http://bakin.test/api/approvals${query}`))
const POST = (id: string, body: unknown) => {
  const url = `http://bakin.test/api/approvals/${encodeURIComponent(id)}/resolve`
  return resolve(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }), new URL(url))
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  onResolve.mockClear()
  onResolve.mockImplementation(async () => {})
  clearApprovalKinds()
  registerApprovalKind<'workflow-gate'>({ kind: 'workflow-gate', ownerState: async () => 'live', onResolve })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /api/approvals', () => {
  it('lists pending records by default and filters by taskIds', async () => {
    requestApproval({ approvalId: 'a', owner: owner('t-1'), request })
    requestApproval({ approvalId: 'b', owner: owner('t-2'), request })
    requestApproval({ approvalId: 'c', owner: owner('t-3'), request })
    await POST('c', { option: 'approve' })

    const all = await (await GET()).json() as { approvals: Array<{ approvalId: string }> }
    expect(all.approvals.map((r) => r.approvalId).sort()).toEqual(['a', 'b'])
    const filtered = await (await GET('?taskIds=t-2,t-3')).json() as { approvals: Array<{ approvalId: string }> }
    expect(filtered.approvals.map((r) => r.approvalId)).toEqual(['b'])
    const resolved = await (await GET('?status=approved')).json() as { approvals: Array<{ approvalId: string }> }
    expect(resolved.approvals.map((r) => r.approvalId)).toEqual(['c'])
    expect((await GET('?status=bogus')).status).toBe(400)
  })
})

describe('POST /api/approvals/:id/resolve', () => {
  it('parses the id out of the path, including encoded characters', () => {
    expect(approvalIdFromPath('/api/approvals/gate%3At-1%3Areview/resolve')).toBe('gate:t-1:review')
    expect(approvalIdFromPath('/api/approvals')).toBeNull()
    expect(approvalIdFromPath('/api/approvals/x/other')).toBeNull()
  })

  it('resolves with the web actor (OS user) and returns the record', async () => {
    requestApproval({ approvalId: 'gate:t-1:review', owner: owner('t-1'), request })
    const res = await POST('gate:t-1:review', { option: 'reject', comment: 'needs work' })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; approval: { status: string; response: { actor: { id: string }; comment: string } } }
    expect(body.ok).toBe(true)
    expect(body.approval.status).toBe('rejected')
    expect(body.approval.response.comment).toBe('needs work')
    expect(body.approval.response.actor.id.length).toBeGreaterThan(0)
    expect(onResolve.mock.calls[0]?.[1]).toMatchObject({ option: 'reject', actor: { source: 'web' } })
  })

  it('maps typed errors: 404 unknown, 409 already resolved, handler status on refusal, 400 bad input', async () => {
    expect((await POST('nope', { option: 'approve' })).status).toBe(404)

    requestApproval({ approvalId: 'done', owner: owner('t-1'), request })
    await POST('done', { option: 'approve' })
    expect((await POST('done', { option: 'reject' })).status).toBe(409)
    expect(getApprovalRecord('done')?.response?.selectedOption).toBe('approve')

    onResolve.mockImplementation(async () => { throw new ApprovalResolveError('gate moved on', 409) })
    requestApproval({ approvalId: 'refused', owner: owner('t-1'), request })
    expect((await POST('refused', { option: 'approve' })).status).toBe(409)
    expect(getApprovalRecord('refused')?.status).toBe('pending')

    expect((await POST('refused', { nope: true })).status).toBe(400)
    expect((await POST('refused', '{ not json')).status).toBe(400)
  })
})
