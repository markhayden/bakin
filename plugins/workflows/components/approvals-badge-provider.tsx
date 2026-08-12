/**
 * ApprovalsBadgeProvider — pending gate approvals ride the global attention
 * system. Mounted in the host's `nav-badge-providers` slot (outside the
 * router): keeps the Workflows nav badge at the pending-gate count and
 * fires toast + OS notification when a gate becomes pending while the user
 * is elsewhere (rules in attention.ts). On Pi — no channel layer — this is
 * the delivery that keeps gated tasks from stalling silently; when a
 * channel bridge exists it stays on as the always-on companion.
 *
 * The durable approval record remains the sole authority; clicking through
 * lands on the task detail where gates are approved/rejected.
 */
import { useCallback, useEffect } from 'react'
import { useNavBadge, usePluginEvent, useRouter, toast, useToastStore } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { Button } from '@makinbakin/sdk/ui'
import { useState } from 'react'

import { sendBrowserNotification } from '../lib/browser-notify'
import { attentionForGate, gateBadge, gateUrl, type GateReachedPayload } from './attention'

interface PendingGatesResponse {
  gates: Array<{ taskId: string; stepId: string; label?: string }>
}

function GateToast({ url, title, body, onNavigate }: { url: string; title: string; body: string; onNavigate?: () => void }) {
  const router = useRouter()
  return (
    <Button
      type="button"
      variant="ghost"
      size="inline"
      onClick={() => {
        onNavigate?.()
        router.push(url)
      }}
    >
      <span className="block min-w-0">
        <span className="font-bakin-typography-weight-medium">{title}</span>
        <span className="block text-bakin-typography-size-meta text-bakin-text-muted">{body}</span>
      </span>
    </Button>
  )
}

export function ApprovalsBadgeProvider() {
  const [pending, setPending] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const res = await pluginFetch('workflows', 'gates/pending')
      if (!res.ok) return
      const body = (await res.json()) as PendingGatesResponse
      setPending(Array.isArray(body.gates) ? body.gates.length : 0)
    } catch {
      /* transient fetch failures keep the last known count */
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  usePluginEvent('workflow.gate_reached', (payload) => {
    void refresh()
    const gate = payload as unknown as GateReachedPayload
    const attention = attentionForGate(gate, window.location)
    if (!attention.notify) return
    // The closure reads `id` only on click, after toast() has returned it —
    // navigating in-app dismisses the toast instead of leaving it to expire.
    const id: string = toast(
      <GateToast
        url={attention.url}
        title={attention.title}
        body={attention.body}
        onNavigate={() => useToastStore.getState().dismiss(id)}
      />,
      'info',
    )
    sendBrowserNotification(attention.title, attention.body, gateUrl(gate))
  })

  usePluginEvent('workflow.gate_approved', () => { void refresh() })
  usePluginEvent('workflow.gate_rejected', () => { void refresh() })

  useNavBadge('workflows', 'workflows', gateBadge(pending))

  return null
}
