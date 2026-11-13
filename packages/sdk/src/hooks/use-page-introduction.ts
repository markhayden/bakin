'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { usePluginEvent } from './use-plugin-event'

/** What a page says about itself the first time someone opens it. */
export interface PageIntroduction {
  title: string
  body: string
}

export interface UsePageIntroductionResult {
  /** The introduction to show, or null: closed, not offered on this home, or not known yet. */
  introduction: PageIntroduction | null
  /** The person closed it: it is gone now and is not shown again, here or in any other browser. */
  close: () => void
}

interface Listed extends PageIntroduction { id: string }

const ROUTE = '/api/plugins/home/page-introductions'

/**
 * The introductions still open on this home, shared by every page: asked
 * for once, then kept. `null` until the first answer.
 */
let open: Map<string, PageIntroduction> | null = null
let asking: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: Map<string, PageIntroduction>): void {
  open = next
  for (const listener of listeners) listener()
}

function ask(): void {
  if (open !== null || asking !== null) return
  asking = fetch(ROUTE)
    .then(async (res) => {
      if (!res.ok) throw new Error(`page introductions answered ${res.status}`)
      const body = await res.json() as { introductions?: Listed[] }
      publish(new Map((body.introductions ?? []).map(({ id, title, body: text }) => [id, { title, body: text }])))
    })
    // No answer means no introduction on this visit; the next page asks again.
    .catch(() => undefined)
    .finally(() => { asking = null })
}

function forget(pageId: string): void {
  if (!open?.has(pageId)) return
  const next = new Map(open)
  next.delete(pageId)
  publish(next)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * A page's first-visit introduction, remembered per home. Pass the page's
 * plugin id; render `introduction` when it is not null and call `close`
 * from its dismiss control. Which pages have one, and what each says, is
 * curated by the Home plugin; a page without one always gets null.
 */
export function usePageIntroduction(pageId: string): UsePageIntroductionResult {
  useEffect(() => { ask() }, [])
  const introduction = useSyncExternalStore(subscribe, () => open?.get(pageId) ?? null, () => null)
  usePluginEvent('home.page_introduction_closed', (payload) => {
    if (typeof payload.id === 'string') forget(payload.id)
  })
  const close = useCallback(() => {
    forget(pageId)
    // If this is lost the introduction simply returns on a later visit.
    void fetch(`${ROUTE}/${encodeURIComponent(pageId)}/close`, { method: 'POST' }).catch(() => undefined)
  }, [pageId])
  return { introduction, close }
}

/** Test seam: forget everything, as a fresh page load would. */
export function resetPageIntroductionsForTests(): void {
  open = null
  asking = null
  listeners.clear()
}
