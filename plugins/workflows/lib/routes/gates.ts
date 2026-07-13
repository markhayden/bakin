/**
 * Workflow Gate routes
 *
 * Human-gate approval surface: approve/reject (JSON API), the durable
 * server-rendered approval fallback page (GET + POST), and the pending /
 * batch-status reads. Handlers delegate to the runtime gate ops, the
 * gate-audit / gate-settings / gate-html helpers, and the approval store.
 */
import { userInfo } from 'os'
import { z } from 'zod'
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import type { ApprovalActor } from '@bakin/core/plugin-types'
import { loadInstance, approveGate, rejectGate, listInstances } from '../runtime'
import { loadDefinition } from '../parser'
import { approvalRefFromRecord, findPendingApprovalForGate, getApprovalRecord } from '../approval-store'
import { resolveGateApproval, sendGateDecisionSummary } from '../notifications'
import { indexInstance } from '../search-sync'
import { triggerDispatch } from '../trigger-dispatch'
import { buildGateAuditPayload } from '../gate-audit'
import { activeGateSettings } from '../gate-settings'
import { formValue, gateDecisionHtmlResponse, escapeHtml } from '../gate-html'
import { passthroughWf, errorResponseWf, htmlResponseWf } from '../route-schemas'

// Web-source approver: REST endpoints come from the Bakin UI, which is
// single-user behind Tailscale. Use the OS username so audit trails can
// identify who clicked the button with at least machine-level granularity.
const webApprover = (): ApprovalActor => {
  const { username } = userInfo()
  return { source: 'web', id: username, displayName: username }
}

// POST /gates/:taskId/approve — approve a gate step
const approveHandler = async (req: Request, ctx: PluginContextLite) => {
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

  // Capture rendered approval reference before approval changes state.
  const preInstance = loadInstance(taskId)
  const approvalRef = approvalRefFromRecord(findPendingApprovalForGate(taskId, stepId))
    ?? preInstance?.stepStates[stepId]?.approvalRef

  const approver = webApprover()
  const result = approveGate(taskId, stepId, { approver })

  if (!result.success) {
    return Response.json({ error: result.errors?.[0], errors: result.errors }, { status: 400 })
  }

  ctx.activity.audit('gate.approved', 'web', buildGateAuditPayload(taskId, stepId, result.decision))
  ctx.activity.log('web', `Gate "${stepId}" approved`, { taskId })
  indexInstance(taskId).catch(() => {})

  // Kick dispatch so the next step's agent starts immediately
  triggerDispatch()

  // Sync rendered approval + summary when channel alerts are enabled.
  const settings = activeGateSettings()
  if (settings.approvalChannelAlerts && result.decision) {
    const instance = loadInstance(taskId)
    resolveGateApproval(
      approvalRef,
      'approved',
      approver,
      result.decision.decidedAt,
    ).catch(() => {})
    if (instance) {
      sendGateDecisionSummary(
        instance,
        stepId,
        result.decision.gateLabel,
        'approved',
        approver,
        result.decision.requestedAt,
        result.decision.decidedAt,
        undefined,
        settings,
        approvalRef,
      ).catch(() => {})
    }
  }

  return Response.json(result)
}

// POST /gates/:taskId/reject — reject a gate step
const rejectHandler = async (req: Request, ctx: PluginContextLite) => {
  const url = new URL(req.url)
  let body: { taskId?: string; stepId?: string; reason?: string; rewindTo?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const taskId = url.searchParams.get('taskId') || body.taskId
  const { stepId, reason, rewindTo } = body
  if (!taskId || !stepId || !reason) {
    return Response.json({ error: 'taskId, stepId, and reason are required' }, { status: 400 })
  }

  // Capture rendered approval reference before rejection changes state.
  const preInstance = loadInstance(taskId)
  const approvalRef = approvalRefFromRecord(findPendingApprovalForGate(taskId, stepId))
    ?? preInstance?.stepStates[stepId]?.approvalRef

  const approver = webApprover()
  const result = rejectGate(taskId, stepId, reason, { rewindTo, approver })

  if (!result.success) {
    return Response.json({ error: result.errors?.[0], errors: result.errors }, { status: 400 })
  }

  ctx.activity.audit('gate.rejected', 'web', buildGateAuditPayload(taskId, stepId, result.decision, reason))
  ctx.activity.log('web', `Gate "${stepId}" rejected: ${reason}`, { taskId })
  indexInstance(taskId).catch(() => {})

  // Sync rendered approval + summary when channel alerts are enabled.
  const settings = activeGateSettings()
  if (settings.approvalChannelAlerts && result.decision) {
    const instance = loadInstance(taskId)
    resolveGateApproval(
      approvalRef,
      'rejected',
      approver,
      result.decision.decidedAt,
      reason,
    ).catch(() => {})
    if (instance) {
      sendGateDecisionSummary(
        instance,
        stepId,
        result.decision.gateLabel,
        'rejected',
        approver,
        result.decision.requestedAt,
        result.decision.decidedAt,
        reason,
        settings,
        approvalRef,
      ).catch(() => {})
    }
  }

  return Response.json(result)
}

const gateDecisionPageHandler = async (req: Request, _ctx: PluginContextLite) => {
  const url = new URL(req.url)
  const taskId = url.searchParams.get('taskId')
  const stepId = url.searchParams.get('stepId')
  const requestedApprovalId = url.searchParams.get('approvalId')
  if (!taskId || !stepId) {
    return gateDecisionHtmlResponse('Approval Link Error', '<p>taskId and stepId are required.</p>', 400)
  }

  // Links omit approvalId (native-card description budget); resolve the
  // pending record for the gate. Explicit approvalId still binds old links.
  const approvalRecord = requestedApprovalId
    ? getApprovalRecord(requestedApprovalId)
    : findPendingApprovalForGate(taskId, stepId)
  if (!approvalRecord || approvalRecord.owner.taskId !== taskId || approvalRecord.owner.stepId !== stepId) {
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

const gateDecisionActionHandler = async (req: Request, ctx: PluginContextLite) => {
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

  // The rendered page embeds the exact approvalId; direct POSTs may omit it.
  const approvalRecord = approvalId
    ? getApprovalRecord(approvalId)
    : findPendingApprovalForGate(taskId, stepId)
  if (!approvalRecord || approvalRecord.owner.taskId !== taskId || approvalRecord.owner.stepId !== stepId) {
    return gateDecisionHtmlResponse('Approval Not Found', '<p>This approval link no longer matches a pending workflow gate.</p>', 404)
  }
  if (approvalRecord.status !== 'pending') {
    return gateDecisionHtmlResponse('Approval Already Decided', `<p>This approval is already ${escapeHtml(approvalRecord.status)}.</p>`)
  }

  const approvalRef = approvalRefFromRecord(approvalRecord)
  const approver = webApprover()
  if (decision === 'approve') {
    const result = approveGate(taskId, stepId, { approver })
    if (!result.success) {
      return gateDecisionHtmlResponse('Approval Failed', `<p>${escapeHtml(result.errors?.[0] || 'Unknown approval failure')}</p>`, 400)
    }

    ctx.activity.audit('gate.approved', 'web', buildGateAuditPayload(taskId, stepId, result.decision))
    ctx.activity.log('web', `Gate "${stepId}" approved from approval link`, { taskId })
    indexInstance(taskId).catch(() => {})
    triggerDispatch()

    const settings = activeGateSettings()
    const instance = loadInstance(taskId)
    if (settings.approvalChannelAlerts && result.decision && instance) {
      resolveGateApproval(approvalRef, 'approved', approver, result.decision.decidedAt).catch(() => {})
      sendGateDecisionSummary(
        instance,
        stepId,
        result.decision.gateLabel,
        'approved',
        approver,
        result.decision.requestedAt,
        result.decision.decidedAt,
        undefined,
        settings,
        approvalRef,
      ).catch(() => {})
    }

    return gateDecisionHtmlResponse('Gate Approved', '<p>The workflow gate was approved. You can close this tab.</p>')
  }

  if (decision === 'reject') {
    const reason = formValue(form, 'reason')?.trim()
    if (!reason) {
      return gateDecisionHtmlResponse('Reject Reason Required', '<p>A reject reason is required.</p>', 400)
    }

    const result = rejectGate(taskId, stepId, reason, { approver })
    if (!result.success) {
      return gateDecisionHtmlResponse('Reject Failed', `<p>${escapeHtml(result.errors?.[0] || 'Unknown rejection failure')}</p>`, 400)
    }

    ctx.activity.audit('gate.rejected', 'web', buildGateAuditPayload(taskId, stepId, result.decision, reason))
    ctx.activity.log('web', `Gate "${stepId}" rejected from approval link: ${reason}`, { taskId })
    indexInstance(taskId).catch(() => {})

    const settings = activeGateSettings()
    const instance = loadInstance(taskId)
    if (settings.approvalChannelAlerts && result.decision && instance) {
      resolveGateApproval(approvalRef, 'rejected', approver, result.decision.decidedAt, reason).catch(() => {})
      sendGateDecisionSummary(
        instance,
        stepId,
        result.decision.gateLabel,
        'rejected',
        approver,
        result.decision.requestedAt,
        result.decision.decidedAt,
        reason,
        settings,
        approvalRef,
      ).catch(() => {})
    }

    return gateDecisionHtmlResponse('Gate Rejected', '<p>The workflow gate was rejected. You can close this tab.</p>')
  }

  return gateDecisionHtmlResponse('Approval Link Error', '<p>decision must be approve or reject.</p>', 400)
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
  defineRoute({ path: '/gates/:taskId/decision', method: 'POST', description: 'Approve or reject a gate through the durable Bakin approval fallback page', summary: 'Approve or reject a gate through the durable Bakin approval fallback page', params: z.object({ taskId: z.string() }), responses: { 200: htmlResponseWf, 400: htmlResponseWf, 404: htmlResponseWf }, handler: gateDecisionActionHandler }),
  defineRoute({ path: '/gates/pending', method: 'GET', description: 'List all gates awaiting approval', summary: 'List all gates awaiting approval', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: pendingGatesHandler }),
  defineRoute({ path: '/gates/status', method: 'GET', activityClass: 'routine', description: 'Batch check gate status for tasks', summary: 'Batch check gate status for tasks', responses: { 200: passthroughWf, 201: passthroughWf, 400: errorResponseWf, 403: errorResponseWf, 404: errorResponseWf, 409: errorResponseWf, 500: errorResponseWf }, handler: gateStatusHandler }),
]
