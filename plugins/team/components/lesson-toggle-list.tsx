'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Package } from 'lucide-react'
import { Switch } from '@makinbakin/sdk/ui'
import { useQueryState } from '@makinbakin/sdk/hooks'

/**
 * Per-agent lessons toggle list. Fetches from
 * /api/agent-packages/{agentId}/lessons, renders a checkbox row per
 * lesson, POSTs to .../lessons/{lessonId} on toggle.
 *
 * Optimistic UI — toggle flips immediately, reverts on server error.
 */

interface Lesson {
  lessonId: string
  title: string
  tags: string[]
  defaultEnabled: boolean
  enabled: boolean
}

export interface LessonToggleListProps {
  agentId: string
}

export function LessonToggleList({ agentId }: LessonToggleListProps) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [packageId, setPackageId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  // ⌘K lesson hits deep-link here as ?tab=lessons&lessonId=<id>; the
  // matching card gets a highlight ring and scrolls into view ONCE per
  // highlight id — `lessons` also changes on every optimistic toggle
  // update, and re-scrolling mid-interaction would yank the viewport.
  const [highlightId] = useQueryState('lessonId', '')
  const highlightRef = useRef<HTMLElement | null>(null)
  const scrolledForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!highlightId) {
      // Param cleared — re-arm so a later deep link to the SAME lesson
      // scrolls again instead of being eaten by the once-guard.
      scrolledForRef.current = null
      return
    }
    if (!lessons || scrolledForRef.current === highlightId) return
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center' })
      scrolledForRef.current = highlightId
    }
  }, [lessons, highlightId])

  // Deliberately NOT `useJsonFetch`: the fetched list becomes local mutable
  // state (optimistic toggle updates + revert), which a read-only hook result
  // can't model without an extra copy-into-state effect.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/agent-packages/${encodeURIComponent(agentId)}/lessons`)
        const body = (await res.json()) as {
          ok: boolean
          packageId?: string
          lessons?: Lesson[]
          error?: string
        }
        if (cancelled) return
        if (!res.ok || !body.ok) {
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }
        setLessons(body.lessons ?? [])
        setPackageId(body.packageId ?? null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [agentId])

  const toggle = async (lessonId: string, nextEnabled: boolean) => {
    if (!lessons) return
    setPendingId(lessonId)
    // Optimistic update
    setLessons(lessons.map((l) => (l.lessonId === lessonId ? { ...l, enabled: nextEnabled } : l)))
    try {
      const res = await fetch(
        `/api/agent-packages/${encodeURIComponent(agentId)}/lessons/${encodeURIComponent(lessonId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextEnabled }),
        },
      )
      const body = (await res.json()) as { ok: boolean; error?: string }
      if (!res.ok || !body.ok) {
        // Revert on failure
        setLessons((prev) =>
          prev ? prev.map((l) => (l.lessonId === lessonId ? { ...l, enabled: !nextEnabled } : l)) : prev,
        )
        setError(body.error ?? `HTTP ${res.status}`)
      } else {
        setError(null)
      }
    } catch (err) {
      setLessons((prev) =>
        prev ? prev.map((l) => (l.lessonId === lessonId ? { ...l, enabled: !nextEnabled } : l)) : prev,
      )
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingId(null)
    }
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    )
  }
  if (lessons === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading lessons...
      </div>
    )
  }
  if (lessons.length === 0) {
    return <p className="text-sm text-muted-foreground">No lessons available from this package.</p>
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {lessons.map((lesson) => {
        const highlighted = highlightId !== '' && lesson.lessonId === highlightId
        return (
        <article
          key={lesson.lessonId}
          ref={highlighted ? highlightRef : undefined}
          data-highlighted={highlighted ? 'true' : undefined}
          className={`group relative flex flex-col gap-3 rounded-xl border p-5 transition-colors ${
            lesson.enabled
              ? 'border-border bg-muted/20 hover:bg-muted/30'
              : 'border-border/60 bg-muted/5 hover:bg-muted/15'
          } ${highlighted ? 'ring-2 ring-primary' : ''}`}
        >
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground leading-snug">{lesson.title}</div>
              <code className="text-[11px] text-muted-foreground/70 font-mono break-all">{lesson.lessonId}</code>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {pendingId === lesson.lessonId && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={lesson.enabled}
                onCheckedChange={(next: boolean) => toggle(lesson.lessonId, next)}
                disabled={pendingId !== null}
                aria-label={`Toggle ${lesson.title}`}
              />
            </div>
          </header>

          {lesson.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {lesson.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {packageId && (
            <footer className="mt-auto pt-2 border-t border-border/40 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <Package className="size-3" />
              <span className="font-mono truncate" title={packageId}>{packageId}</span>
            </footer>
          )}
        </article>
        )
      })}
    </div>
  )
}
