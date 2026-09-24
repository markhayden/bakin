/**
 * Approval notifications — pending gate approvals ride the global attention
 * system. Mounted in the host's `nav-badge-providers` slot (outside the
 * router): pending approvals are indicated by Tasks; this provider
 * fires toast + OS notification when a gate becomes pending while the user
 * is elsewhere (rules in attention.ts). On Pi — no channel layer — this is
 * the delivery that keeps gated tasks from stalling silently; when a
 * channel bridge exists it stays on as the always-on companion.
 *
 * The durable approval record remains the sole authority; clicking through
 * lands on the task detail where gates are approved/rejected.
 */
import { usePluginEvent, useRouter, toast, useToastStore } from '@makinbakin/sdk/hooks'
import { Button, Text } from '@makinbakin/sdk/ui'

import { sendBrowserNotification } from '../lib/browser-notify'
import { attentionForGate, gateUrl, type GateReachedPayload } from './attention'

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
        <Text size="meta" tone="muted" className="block">{body}</Text>
      </span>
    </Button>
  )
}

export function ApprovalsBadgeProvider() {
  usePluginEvent('workflow.gate_reached', (payload) => {
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

  return null
}
