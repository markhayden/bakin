/**
 * SpendBadgeProvider — the spend ladder rides the global attention system.
 * Mounted in the host's `nav-badge-providers` slot (outside the router,
 * eager so it is live on every page): keeps the Spend nav badge at the
 * number of rows needing attention (unacknowledged 90% rows + open cap
 * incidents), keeps one persistent toast per such row (`useLadderToasts`
 * — closing it acknowledges), and fires toast + OS notification for the
 * 50/75 heads-up milestones (rules in attention.ts). Everything derives
 * from durable rows on reload; the SSE event is only the nudge,
 * de-duplicated on its eventId so an at-least-once delivery never toasts
 * twice.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavBadge, usePluginEvent, useRouter, toast, useToastStore } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { Button, Text } from '@makinbakin/sdk/ui'

import { sendBrowserNotification } from '../lib/browser-notify'
import {
  milestoneNotifies,
  milestoneToast,
  spendBadge,
  type LiveMilestoneRow,
  type MilestoneEventPayload,
  type OpenIncidentRow,
} from './attention'
import { useLadderToasts } from './ladder-toasts'

interface LiteStatus {
  paused?: boolean
  milestones?: LiveMilestoneRow[]
  openIncidents?: OpenIncidentRow[]
}

function MilestoneToast({ url, title, body, onNavigate }: { url: string; title: string; body: string; onNavigate?: () => void }) {
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

export function SpendBadgeProvider() {
  const [rows, setRows] = useState<LiveMilestoneRow[]>([])
  const [incidents, setIncidents] = useState<OpenIncidentRow[]>([])
  // At-least-once delivery ⇒ the same eventId can arrive twice; toast once.
  const seen = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    try {
      const res = await pluginFetch('spend', 'status?lite=1')
      if (!res.ok) return
      const body = (await res.json()) as LiteStatus
      setRows(Array.isArray(body.milestones) ? body.milestones : [])
      setIncidents(Array.isArray(body.openIncidents) ? body.openIncidents : [])
    } catch {
      /* transient fetch failures keep the last known rows */
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  usePluginEvent('spend.milestone', (payload) => {
    void refresh()
    const event = payload as unknown as MilestoneEventPayload
    if (typeof event.eventId !== 'string' || seen.current.has(event.eventId)) return
    seen.current.add(event.eventId)
    if (!milestoneNotifies(event.highest)) return
    const { title, body, url } = milestoneToast(event)
    // The closure reads `id` only on click, after toast() has returned it —
    // navigating in-app dismisses the toast instead of leaving it to expire.
    const id: string = toast(
      <MilestoneToast url={url} title={title} body={body} onNavigate={() => useToastStore.getState().dismiss(id)} />,
      'info',
    )
    sendBrowserNotification(title, body, url)
  })
  usePluginEvent('budget.incident_opened', () => { void refresh() })
  usePluginEvent('budget.incident_resolved', () => { void refresh() })
  usePluginEvent('spend.milestone_acknowledged', () => { void refresh() })

  useNavBadge('spend', 'spend', spendBadge(rows, incidents))
  useLadderToasts(rows, incidents, refresh)

  return null
}
