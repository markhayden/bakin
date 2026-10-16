/**
 * Operations attention (#895 D14) — the ONE toast + OS-notification path for
 * long-running work, mounted beside `ApprovalsAttentionProvider`. It
 * announces finished, failed and stuck (once per stage) for operations a
 * person started on the web, the CLI or Discord. The rules are pure
 * (operation-attention.ts); the tray and each flow's own surface show the
 * live state.
 */
import { useRef } from 'react'
import { usePluginEvent, useRouter, toast, useToastStore } from '@makinbakin/sdk/hooks'
import { Button, Text } from '@makinbakin/sdk/ui'
import type { OperationView } from '@makinbakin/sdk/types'

import { sendBrowserNotification } from '@/lib/browser-notify'
import { nextOperationAttention, type OperationAttentionMemo, type OperationNotice } from './operation-attention'

const TOAST_TYPE: Record<OperationNotice['kind'], 'success' | 'error' | 'info'> = {
  finished: 'success',
  failed: 'error',
  stuck: 'info',
}

function OperationToast({ notice, onNavigate }: { notice: OperationNotice; onNavigate?: () => void }) {
  const router = useRouter()
  const text = (
    <span className="block min-w-0">
      <span className="font-bakin-typography-weight-medium">{notice.title}</span>
      <Text size="meta" tone="muted" className="block">{notice.body}</Text>
    </span>
  )
  if (!notice.url) return text
  const url = notice.url
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
      {text}
    </Button>
  )
}

export function OperationsAttentionProvider() {
  const memos = useRef(new Map<string, OperationAttentionMemo>())

  usePluginEvent('operation.updated', (payload) => {
    const view = payload.view as OperationView | undefined
    if (!view || typeof view.id !== 'string') return
    const { notice, memo } = nextOperationAttention(view, memos.current.get(view.id), Date.now(), window.location)
    memos.current.set(view.id, memo)
    if (!notice) return
    const id: string = toast(
      <OperationToast notice={notice} onNavigate={() => useToastStore.getState().dismiss(id)} />,
      TOAST_TYPE[notice.kind],
    )
    sendBrowserNotification(notice.title, notice.body, notice.url)
  })

  return null
}
