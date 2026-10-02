/**
 * Approvals attention — the ONE toast + OS-notification path for every
 * pending approval, whatever its kind (spec D6/D7). Host-owned and mounted
 * beside the `nav-badge-providers` slot, outside the router. The board's
 * "Needs approval" signal and the Tasks nav badge show the pending state;
 * this provider only announces a NEW pending approval while the user is
 * elsewhere (rules in approval-attention.ts). The durable record stays the
 * authority — clicking through lands on the task detail where it is decided.
 */
import { usePluginEvent, useRouter, toast, useToastStore } from '@makinbakin/sdk/hooks'
import { Button, Text } from '@makinbakin/sdk/ui'

import { sendBrowserNotification } from '@/lib/browser-notify'
import { attentionForApproval, type ApprovalPendingPayload } from './approval-attention'

function ApprovalToast({ url, title, body, onNavigate }: { url: string; title: string; body: string; onNavigate?: () => void }) {
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

export function ApprovalsAttentionProvider() {
  usePluginEvent('approval.pending', (payload) => {
    const pending = payload as unknown as ApprovalPendingPayload
    if (!pending.taskId) return
    const attention = attentionForApproval(pending, window.location)
    if (!attention.notify) return
    // The closure reads `id` only on click, after toast() has returned it —
    // navigating in-app dismisses the toast instead of leaving it to expire.
    const id: string = toast(
      <ApprovalToast
        url={attention.url}
        title={attention.title}
        body={attention.body}
        onNavigate={() => useToastStore.getState().dismiss(id)}
      />,
      'info',
    )
    sendBrowserNotification(attention.title, attention.body, attention.url)
  })

  return null
}
