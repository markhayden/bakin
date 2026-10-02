/**
 * Workflow Gate routes
 *
 * Human-gate decision surface: approve/reject (JSON API), the durable
 * server-rendered decision page (GET + POST), and the pending / batch-status
 * reads. Every decision goes through the gate's pending approval record in
 * core (`decideGate` → `resolveApproval`); these handlers only parse input,
 * pick the web actor and map typed errors to status codes.
 */
import { userInfo } from 'os'
import { z } from 'zod'
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import type { ApprovalActor } from '@bakin/core/plugin-types'
import { getApprovalRecord, type ApprovalRecord } from '@bakin/core/approvals'
import { approvalErrorStatus } from '../../../../src/core/approvals'
import { loadInstance, listInstances } from '../runtime'
import { loadDefinition } from '../parser'
import { decideGate, pendingGateApproval } from '../approval-kind'
import { formValue, gateDecisionHtmlResponse, escapeHtml } from '../gate-html'
import { passthroughWf, errorResponseWf, htmlResponseWf } from '../route-schemas'

// Web-source approver: REST endpoints come from the Bakin UI, which is
// single-user behind Tailscale. Use the OS username so audit trails can
// identify who clicked the button with at least machine-level granularity.
const webApprover = (): ApprovalActor => {
  const { username } = userInfo()
  return { source: 'web', id: username, displayName: username }
}

function approvalErrorJson(err: unknown): Response {
  const status = approvalErrorStatus(err)
  if (status === null) throw err
  const message = (err as Error).message
  return Response.json({ error: message, errors: [message] }, { status })
}

// POST /gates/:taskId/approve — approve a gate step
const approveHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  let body: { taskId?: string; stepId?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const taskId = url.searchParams.get('taskId') || body.taskId
  const { stepId } = body
  if (!taskId || !stepId) {
    return Response.json({ error: 'taskId and stepId are required' }, { status: 400 })
  }

  try {
    const approval = await decideGate(taskId, stepId, 'approve', webApprover())
    return Response.json({ success: true, approval })
  } catch (err) {
    return approvalErrorJson(err)
  }
}

// POST /gates/:taskId/reject — reject a gate step
const rejectHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  let body: { taskId?: string; stepId?: string; reason?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const taskId = url.searchParams.get('taskId') || body.taskId
  const { stepId, reason } = body
  if (!taskId || !stepId) {
    return Response.json({ error: 'taskId and stepId are required' }, { status: 400 })
  }

  try {
    const approval = await decideGate(taskId, stepId, 'reject', webApprover(), reason)
    const rewoundTo = loadInstance(taskId)?.currentStepId
    return Response.json({ success: true, approval, ...(rewoundTo ? { rewoundTo } : {}) })
  } catch (err) {
    return approvalErrorJson(err)
  }
}

/** The record a decision link points at: explicit approvalId, else the gate's pending record. */
function approvalForLink(taskId: string, stepId: string, approvalId: string | null | undefined): ApprovalRecord | null {
  const record = approvalId ? getApprovalRecord(approvalId) : pendingGateApproval(taskId, stepId)
  if (!record || record.owner.kind !== 'workflow-gate' || record.owner.taskId !== taskId || record.owner.stepId !== stepId) return null
  return record
}

const gateDecisionPageHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  const taskId = url.searchParams.get('taskId')
  const stepId = url.searchParams.get('stepId')
  if (!taskId || !stepId) {
    return gateDecisionHtmlResponse('Approval Link Error', '<p>taskId and stepId are required.</p>', 400)
  }

  // Links omit approvalId (native-card description budget); resolve the
  // pending record for the gate. Explicit approvalId still binds old links.
  const approvalRecord = approvalForLink(taskId, stepId, url.searchParams.get('approvalId'))
  if (!approvalRecord) {
    return gateDecisionHtmlResponse('Approval Not Found', '<p>This approval link no longer matches a pending workflow gate.</p>', 404)
  }
  const approvalId = approvalRecord.approvalId

  const escapedTitle = escapeHtml(approvalRecord.request.title)
  const escapedBody = escapeHtml(approvalRecord.request.body)
  const statusText = approvalRecord.status === 'pending'
    ? ''
    : `<p class="notice">This approval has already been marked ${escapeHtml(approvalRecord.status)}.</p>`
  const disabled = approvalRecord.status === 'pending' ? '' : ' disabled'
  return gateDecisionHtmlResponse(approvalRecord.request.title, `
    <p class="eyebrow">Workflow Approval</p>
    <h1>${escapedTitle}</h1>
    <pre>${escapedBody}</pre>
    ${statusText}
    <form method="POST">
      <input type="hidden" name="approvalId" value="${escapeHtml(approvalId)}" />
      <input type="hidden" name="taskId" value="${escapeHtml(taskId)}" />
      <input type="hidden" name="stepId" value="${escapeHtml(stepId)}" />
      <button name="decision" value="approve"${disabled}>Approve</button>
    </form>
    <form method="POST">
      <input type="hidden" name="approvalId" value="${escapeHtml(approvalId)}" />
      <input type="hidden" name="taskId" value="${escapeHtml(taskId)}" />
      <input type="hidden" name="stepId" value="${escapeHtml(stepId)}" />
      <label for="reason">Reject reason</label>
      <textarea id="reason" name="reason" rows="4"${disabled}></textarea>
      <button class="danger" name="decision" value="reject"${disabled}>Reject</button>
    </form>
  `)
}

const gateDecisionActionHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return gateDecisionHtmlResponse('Approval Link Error', '<p>Invalid form submission.</p>', 400)
  }

  const taskId = url.searchParams.get('taskId') || formValue(form, 'taskId')
  const stepId = url.searchParams.get('stepId') || formValue(form, 'stepId')
  const approvalId = url.searchParams.get('approvalId') || formValue(form, 'approvalId')
  const decision = formValue(form, 'decision')
  if (!taskId || !stepId || !decision) {
    return gateDecisionHtmlResponse('Approval Link Error', '<p>taskId, stepId, and decision are required.</p>', 400)
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return gateDecisionHtmlResponse('Approval Link Error', '<p>decision must be approve or reject.</p>', 400)
  }

  // The rendered page embeds the exact approvalId; direct POSTs may omit it.
  const approvalRecord = approvalForLink(taskId, stepId, approvalId)
  if (!approvalRecord) {
    return gateDecisionHtmlResponse('Approval Not Found', '<p>This approval link no longer matches a pending workflow gate.</p>', 404)
  }
  if (approvalRecord.status !== 'pending') {
    return gateDecisionHtmlResponse('Approval Already Decided', `<p>This approval is already ${escapeHtml(approvalRecord.status)}.</p>`)
  }

  const reason = formValue(form, 'reason')?.trim()
  try {
    await decideGate(taskId, stepId, decision, webApprover(), reason)
  } catch (err) {
    const status = approvalErrorStatus(err)
    if (status === null) throw err
    const title = decision === 'approve' ? 'Approval Failed' : 'Reject Failed'
    return gateDecisionHtmlResponse(title, `<p>${escapeHtml((err as Error).message)}</p>`, status === 409 ? 409 : 400)
  }
  return decision === 'approve'
    ? gateDecisionHtmlResponse('Gate Approved', '<p>The workflow gate was approved. You can close this tab.</p>')
    : gateDecisionHtmlResponse('Gate Rejected', '<p>The workflow gate was rejected. You can close this tab.</p>')
}

// GET /gates/pending — list all gates awaiting approval
const pendingGatesHandler = async (_req: Request, _ctx: PluginContextLite) => {
  const instances = listInstances('pending_approval')
  const gates = instances.map((inst) => {
    const def = loadDefinition(inst.workflowId)
    const gateStep = def?.steps.find(s => s.id === inst.currentStepId)

    // Gather prior step outputs for review
    const priorStepOutputs: Record<string, unknown> = {}
    if (def && gateStep) {
      const gateIdx = def.steps.findIndex(s => s.id === gateStep.id)
      const preview = (gateStep as { preview?: string[] }).preview
      if (preview && preview.length > 0) {
        for (const pid of preview) {
          if (inst.stepStates[pid]?.output) {
            priorStepOutputs[pid] = inst.stepStates[pid].output
          }
        }
      } else if (gateIdx > 0) {
        const priorStep = def.steps[gateIdx - 1]
        if (inst.stepStates[priorStep.id]?.output) {
          priorStepOutputs[priorStep.id] = inst.stepStates[priorStep.id].output
        }
      }
    }

    return {
      taskId: inst.taskId,
      workflowId: inst.workflowId,
      stepId: inst.currentStepId,
      label: gateStep?.label || inst.currentStepId,
      description: (gateStep as { description?: string })?.description,
      priorStepOutputs,
      gateDefinition: gateStep ? {
        on_reject: (gateStep as { on_reject?: { goto: string; note_to_agent?: boolean } }).on_reject,
      } : undefined,
    }
  })

  return Response.json({ gates })
}

// GET /gates/status — batch check gate status for tasks
const gateStatusHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  const taskIds = (url.searchParams.get('taskIds') || '').split(',').filter(Boolean)

  const result: Record<string, { stepId: string; label: string; description?: string; childTaskId?: string } | null> = {}
  for (const taskId of taskIds) {
    const instance = loadInstance(taskId)
    if (instance && instance.status === 'pending_approval') {
      const def = loadDefinition(instance.workflowId)
      const gateStep = def?.steps.find(s => s.id === instance.currentStepId)
      result[taskId] = {
        stepId: instance.currentStepId,
        label: gateStep?.label || instance.currentStepId,
        description: (gateStep as { description?: string })?.description,
      }
    } else if (instance && instance.status === 'in_progress') {
      const childEntry = Object.entries(instance.stepStates).find(
        ([, state]) => state.status === 'in_progress' && state.childTaskId
      )
      if (childEntry) {
        const def = loadDefinition(instance.workflowId)
        const step = def?.steps.find(s => s.id === childEntry[0])
        result[taskId] = {
          stepId: childEntry[0],
          label: step?.label || childEntry[0],
          childTaskId: childEntry[1].childTaskId,
        }
      } else {
        result[taskId] = null
      }
    } else {
      result[taskId] = null
    }
  }

  return Response.json({ gates: result })
}

export const gateRoutes = [
  defineRoute({ path: '/gates/:taskId/approve', method: 'POST', description: 'Approve a human gate step', summary: 'Approve a human gate step', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: approveHandler }),
  defineRoute({ path: '/gates/:taskId/reject', method: 'POST', description: 'Reject a gate step, rewinds workflow', summary: 'Reject a gate step, rewinds workflow', params: z.object({ taskId: z.string() }), responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: rejectHandler }),
  defineRoute({ path: '/gates/:taskId/decision', method: 'GET', description: 'Render a durable Bakin gate approval fallback page', summary: 'Render a durable Bakin gate approval fallback page', params: z.object({ taskId: z.string() }), responses: { 200: htmlResponseWf, 400: htmlResponseWf, 404: htmlResponseWf }, handler: gateDecisionPageHandler }),
  defineRoute({ path: '/gates/:taskId/decision', method: 'POST', description: 'Approve or reject a gate through the durable Bakin approval fallback page', summary: 'Approve or reject a gate through the durable Bakin approval fallback page', params: z.object({ taskId: z.string() }), responses: { 200: htmlResponseWf, 400: htmlResponseWf, 404: htmlResponseWf, 409: htmlResponseWf }, handler: gateDecisionActionHandler }),
  defineRoute({ path: '/gates/pending', method: 'GET', description: 'List all gates awaiting approval', summary: 'List all gates awaiting approval', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: pendingGatesHandler }),
  defineRoute({ path: '/gates/status', method: 'GET', activityClass: 'routine', description: 'Batch check gate status for tasks', summary: 'Batch check gate status for tasks', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: gateStatusHandler }),
]
