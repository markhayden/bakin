/**
 * ctx.approvals in the published harness (spec D26), written the way an
 * external author would: only `@makinbakin/sdk` imports, no content-dir
 * mocks. The harness runs the host's own rules over an in-memory store and
 * `resolveApproval` plays the operator.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { definePlugin } from '@makinbakin/sdk'
import type { PluginApproval, PluginApprovalDecision, PluginContext } from '@makinbakin/sdk/types'
import { activatePlugin } from '@makinbakin/sdk/testing'

const decisions: PluginApprovalDecision[] = []
let approvals: PluginContext['approvals'] | undefined

const plugin = definePlugin({
  id: 'launches',
  name: 'launches',
  version: '0.1.0',
  activate: (ctx) => {
    approvals = ctx.approvals
    ctx.approvals.registerGate('ship', {
      ownerState: () => 'live',
      onResolve: (approval: PluginApproval, decision: PluginApprovalDecision) => {
        if (approval.entityId === 'frozen') throw ctx.approvals.refusal('Launch is frozen', 409)
        decisions.push(decision)
      },
    })
  },
})

const harness = await activatePlugin(plugin)
afterAll(() => harness.dispose())

describe('ctx.approvals in the SDK harness', () => {
  it('request → resolveApproval runs the gate and records the decision', async () => {
    const pending = approvals!.request({ approvalId: 'launches:v2:ship:1', gateKind: 'ship', entityId: 'v2', taskId: 'task-1', title: 'Ship v2?', summary: 'Ready.' })
    expect(pending).toMatchObject({ status: 'pending', options: [{ id: 'approve' }, { id: 'reject' }] })
    expect(approvals!.listPending({ entityId: 'v2' })).toHaveLength(1)

    const decided = await harness.resolveApproval('launches:v2:ship:1', 'reject', 'Docs missing')
    expect(decided).toMatchObject({ status: 'rejected', response: { option: 'reject', comment: 'Docs missing' } })
    expect(decisions).toEqual([expect.objectContaining({ option: 'reject', comment: 'Docs missing', decidedBy: 'Declared in UI' })])
    expect(approvals!.listPending()).toEqual([])
  })

  it('a refusal leaves the approval pending; ids outside the namespace are refused', async () => {
    approvals!.request({ approvalId: 'launches:frozen:ship:1', gateKind: 'ship', entityId: 'frozen', taskId: 'task-2', title: 'Ship?', summary: '' })
    await expect(harness.resolveApproval('launches:frozen:ship:1', 'approve')).rejects.toMatchObject({ status: 409 })
    expect(approvals!.get('launches:frozen:ship:1')?.status).toBe('pending')
    expect(() => approvals!.request({ approvalId: 'other:x', gateKind: 'ship', entityId: 'x', taskId: 't', title: 'x', summary: '' })).toThrow(/launches:/)
  })
})
