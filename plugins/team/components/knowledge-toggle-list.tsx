'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Switch } from '@bakin/sdk/ui'

/**
 * Per-agent knowledge toggle list. Fetches from
 * /api/agent-packages/{agentId}/knowledge, renders a checkbox row per
 * lesson, POSTs to .../knowledge/{lessonId} on toggle.
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

export interface KnowledgeToggleListProps {
  agentId: string
}

export function KnowledgeToggleList({ agentId }: KnowledgeToggleListProps) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [packageId, setPackageId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/agent-packages/${encodeURIComponent(agentId)}/knowledge`)
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
        `/api/agent-packages/${encodeURIComponent(agentId)}/knowledge/${encodeURIComponent(lessonId)}`,
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
        Loading knowledge…
      </div>
    )
  }
  if (lessons.length === 0) {
    return <p className="text-sm text-muted-foreground">No knowledge available from this package.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {packageId && (
        <p className="text-xs text-muted-foreground">
          From package <code className="rounded bg-muted px-1 py-0.5">{packageId}</code>
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {lessons.map((lesson) => (
          <li
            key={lesson.lessonId}
            className="flex items-start justify-between gap-3 rounded border border-border/60 p-3"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{lesson.title}</span>
                <code className="text-xs text-muted-foreground">{lesson.lessonId}</code>
              </div>
              {lesson.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
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
            </div>
            <div className="flex items-center gap-2">
              {pendingId === lesson.lessonId && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={lesson.enabled}
                onCheckedChange={(next: boolean) => toggle(lesson.lessonId, next)}
                disabled={pendingId !== null}
                aria-label={`Toggle ${lesson.title}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
