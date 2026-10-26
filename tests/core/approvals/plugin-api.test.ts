/**
 * ctx.approvals rules (spec D26) — the ONE implementation shared by host and
 * SDK harness, exercised over the in-memory backend: owner pluginId from the
 * context, `<pluginId>:` id prefix, own-records-only reads/cancels, default
 * options, refusal status, and decision mapping for the gate.
 */
import { describe, it, expect } from 'bun:test'
import { createMemoryApprovalsBackend, createPluginApprovalsAPI, DEFAULT_GATE_OPTIONS, PluginApprovalRefusal } from '../../../packages/core/src/approvals/plugin-api'
import type { PluginApproval, PluginApprovalDecision } from '../../../packages/sdk/src/types'

const input = (approvalId = 'projects:launch:complete:project:1') => ({
  approvalId, gateKind: 'complete', entityId: 'launch', taskId: 'steward-1', title: 'Sign off: Launch', summary: 'All steps done.',
})

describe('createPluginApprovalsAPI', () => {
  it('stamps the owner from the context and defaults the options', () => {
    const approvals = createPluginApprovalsAPI('projects', createMemoryApprovalsBackend())
    const approval = approvals.request(input())
    expect(approval).toMatchObject({ approvalId: 'projects:launch:complete:project:1', gateKind: 'complete', entityId: 'launch', taskId: 'steward-1', status: 'pending', summary: 'All steps done.' })
    expect(approval.options).toEqual(DEFAULT_GATE_OPTIONS)
  })

  it('refuses ids outside the plugin namespace and missing fields', () => {
    const approvals = createPluginApprovalsAPI('projects', createMemoryApprovalsBackend())
    expect(() => approvals.request(input('messaging:x'))).toThrow(/must start with "projects:"/)
    expect(() => approvals.request(input('projects:'))).toThrow(/must start with/)
    expect(() => approvals.request({ ...input(), taskId: '' })).toThrow(/taskId is required/)
  })

  it('refuses option ids a decision transport cannot round-trip, duplicates and blank labels', () => {
    const approvals = createPluginApprovalsAPI('projects', createMemoryApprovalsBackend())
    const ask = (options: Array<{ id: string; label: string }>) => () => approvals.request({ ...input(), options })
    expect(ask([{ id: 'approve', label: 'All' }, { id: 'approve:partial', label: 'Partial' }])).toThrow(/letters, digits/)
    expect(ask([{ id: 'x'.repeat(65), label: 'Long' }])).toThrow(/1–64/)
    expect(ask([{ id: '', label: 'Empty' }])).toThrow(/1–64/)
    expect(ask([{ id: 'approve', label: 'A' }, { id: 'approve', label: 'B' }])).toThrow(/offered twice/)
    expect(ask([{ id: 'approve', label: ' ' }])).toThrow(/needs a label/)
    expect(approvals.request({ ...input(), options: [{ id: 'approve_partial', label: 'Partial' }, { id: 'reject', label: 'Reject' }] }).options.map((o) => o.id)).toEqual(['approve_partial', 'reject'])
  })

  it('never touches a record another owner holds — not by request, get, cancel or list', async () => {
    const backend = createMemoryApprovalsBackend()
    backend.request({ approvalId: 'projects:hijack', owner: { kind: 'workflow-gate', taskId: 't', workflowId: 'w', runId: 'r', stepId: 's' }, request: { title: 'Gate', body: '', options: [] } })
    const other = createPluginApprovalsAPI('other', backend)
    other.request({ ...input('other:launch:complete:1') })
    const approvals = createPluginApprovalsAPI('projects', backend)

    expect(() => approvals.request(input('projects:hijack'))).toThrow(/belongs to another owner/)
    expect(backend.get('projects:hijack')?.owner.kind).toBe('workflow-gate')
    expect(approvals.get('projects:hijack')).toBeNull()
    expect(approvals.get('other:launch:complete:1')).toBeNull()
    expect(await approvals.cancel('other:launch:complete:1', 'nope')).toBeNull()
    expect(backend.get('other:launch:complete:1')?.status).toBe('pending')
    expect(approvals.listPending()).toEqual([])
  })

  it('listPending filters to this plugin, then by entity and gate kind', () => {
    const approvals = createPluginApprovalsAPI('projects', createMemoryApprovalsBackend())
    approvals.request(input('projects:a:complete:1'))
    approvals.request({ ...input('projects:b:signoff:t9:1'), entityId: 'b', gateKind: 'signoff' })
    expect(approvals.listPending().map((a) => a.approvalId).sort()).toEqual(['projects:a:complete:1', 'projects:b:signoff:t9:1'])
    expect(approvals.listPending({ entityId: 'b' }).map((a) => a.approvalId)).toEqual(['projects:b:signoff:t9:1'])
    expect(approvals.listPending({ gateKind: 'complete' }).map((a) => a.approvalId)).toEqual(['projects:a:complete:1'])
  })

  it('the gate sees the plugin view of the record and a mapped decision; a refusal leaves it pending', async () => {
    const backend = createMemoryApprovalsBackend()
    const approvals = createPluginApprovalsAPI('projects', backend)
    const seen: Array<[PluginApproval, PluginApprovalDecision]> = []
    let refuse = true
    approvals.registerGate('complete', {
      ownerState: () => 'live',
      onResolve: (approval, decision) => {
        seen.push([approval, decision])
        if (refuse) throw approvals.refusal('Project already completed')
      },
    })
    approvals.request(input())

    const err = await backend.resolve('projects:launch:complete:project:1', 'approve').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PluginApprovalRefusal)
    expect((err as PluginApprovalRefusal).status).toBe(409)
    expect(approvals.get('projects:launch:complete:project:1')?.status).toBe('pending')

    refuse = false
    await backend.resolve('projects:launch:complete:project:1', 'reject', 'needs the docs page')
    const [approval, decision] = seen[1]!
    expect(approval).toMatchObject({ approvalId: 'projects:launch:complete:project:1', entityId: 'launch', status: 'pending' })
    expect(decision).toMatchObject({ option: 'reject', comment: 'needs the docs page' })
    expect(decision.decidedBy).toBe('Declared in UI')
    expect(approvals.get('projects:launch:complete:project:1')).toMatchObject({ status: 'rejected', response: { option: 'reject', comment: 'needs the docs page' } })
  })

  it('an option the approval did not offer never reaches the gate (400)', async () => {
    const backend = createMemoryApprovalsBackend()
    const approvals = createPluginApprovalsAPI('projects', backend)
    const seen: string[] = []
    approvals.registerGate('complete', { ownerState: () => 'live', onResolve: (_a, d) => { seen.push(d.option) } })
    approvals.request(input())
    const err = await backend.resolve('projects:launch:complete:project:1', 'rejectt').catch((e: unknown) => e)
    expect((err as PluginApprovalRefusal).status).toBe(400)
    expect(seen).toEqual([])
    expect(approvals.get('projects:launch:complete:project:1')?.status).toBe('pending')
  })

  it('the harness keeps the host guards: one resolver at a time, and a record cancelled during onResolve stays cancelled', async () => {
    const backend = createMemoryApprovalsBackend()
    const approvals = createPluginApprovalsAPI('projects', backend)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let cancelInside = false
    approvals.registerGate('complete', {
      ownerState: () => 'live',
      onResolve: async (approval) => {
        if (cancelInside) { await approvals.cancel(approval.approvalId, 'project completed'); return }
        await gate
      },
    })
    approvals.request(input())
    const first = backend.resolve('projects:launch:complete:project:1', 'approve')
    await expect(backend.resolve('projects:launch:complete:project:1', 'reject', 'no')).rejects.toThrow(/already being resolved/)
    release()
    expect((await first).status).toBe('approved')

    cancelInside = true
    approvals.request(input('projects:launch:complete:project:2'))
    await expect(backend.resolve('projects:launch:complete:project:2', 'approve')).rejects.toThrow(/no longer pending \(cancelled\)/)
    expect(approvals.get('projects:launch:complete:project:2')?.status).toBe('cancelled')
  })

  it('an existing id is never rewritten — pending or decided (a changed request is a new generation)', async () => {
    const backend = createMemoryApprovalsBackend()
    const approvals = createPluginApprovalsAPI('projects', backend)
    approvals.registerGate('complete', { ownerState: () => 'live', onResolve: () => {} })
    approvals.request(input())
    expect(approvals.request({ ...input(), summary: 'Updated.' }).summary).toBe('All steps done.')
    await backend.resolve('projects:launch:complete:project:1', 'approve')
    expect(approvals.request({ ...input(), summary: 'Again.' })).toMatchObject({ status: 'approved', summary: 'All steps done.' })
  })

  it('a re-request while the gate is deciding cannot swap the subject being approved', async () => {
    const backend = createMemoryApprovalsBackend()
    const approvals = createPluginApprovalsAPI('projects', backend)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const applied: string[] = []
    approvals.registerGate('complete', { ownerState: () => 'live', onResolve: async (a) => { applied.push(a.entityId); await gate } })
    approvals.request(input())
    const deciding = backend.resolve('projects:launch:complete:project:1', 'approve')
    approvals.request({ ...input(), entityId: 'other-project' })
    release()
    const resolved = await deciding
    expect(applied).toEqual(['launch'])
    expect(resolved.owner).toMatchObject({ entityId: 'launch' })
  })

  it('backends get a snapshot of the options — the caller\'s objects never reach them', () => {
    const backend = createMemoryApprovalsBackend()
    const seen: unknown[] = []
    const spy = { ...backend, request: (input: Parameters<typeof backend.request>[0]) => { seen.push(input.request.options); return backend.request(input) } }
    const approvals = createPluginApprovalsAPI('projects', spy)
    const options = [{ id: 'approve', label: 'Approve' }]
    approvals.request({ ...input(), options })
    approvals.request({ ...input('projects:launch:complete:project:2') })
    expect(seen[0]).not.toBe(options)
    expect((seen[0] as Array<unknown>)[0]).not.toBe(options[0])
    expect((seen[1] as Array<unknown>)[0]).not.toBe(DEFAULT_GATE_OPTIONS[0])
  })

  it('the harness snapshots the request — mutating the caller\'s options later changes nothing', async () => {
    const backend = createMemoryApprovalsBackend()
    const approvals = createPluginApprovalsAPI('projects', backend)
    approvals.registerGate('complete', { ownerState: () => 'live', onResolve: () => {} })
    const options = [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }]
    approvals.request({ ...input(), options })
    options[0]!.id = 'unoffered'
    const err = await backend.resolve('projects:launch:complete:project:1', 'unoffered').catch((e: unknown) => e)
    expect((err as PluginApprovalRefusal).status).toBe(400)
    expect(approvals.get('projects:launch:complete:project:1')?.options[0]?.id).toBe('approve')
  })

  it('the harness applies the host reject-reason rule (default on; configurable)', async () => {
    const strict = createMemoryApprovalsBackend()
    const approvals = createPluginApprovalsAPI('projects', strict)
    const seen: string[] = []
    approvals.registerGate('complete', { ownerState: () => 'live', onResolve: (_a, d) => { seen.push(d.option) } })
    expect(approvals.request(input())).toBeTruthy()
    expect(strict.get('projects:launch:complete:project:1')?.request.context).toEqual({ requireRejectReason: true })
    const err = await strict.resolve('projects:launch:complete:project:1', 'reject').catch((e: unknown) => e)
    expect((err as PluginApprovalRefusal).status).toBe(400)
    expect(seen).toEqual([])
    expect((await strict.resolve('projects:launch:complete:project:1', 'reject', 'needs docs')).status).toBe('rejected')

    const lax = createMemoryApprovalsBackend({ requireRejectReason: false })
    const laxApprovals = createPluginApprovalsAPI('projects', lax)
    laxApprovals.registerGate('complete', { ownerState: () => 'live', onResolve: () => {} })
    laxApprovals.request(input())
    expect((await lax.resolve('projects:launch:complete:project:1', 'reject')).status).toBe('rejected')
  })
})
