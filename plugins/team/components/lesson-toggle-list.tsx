'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { ListRow, ListRows } from '@makinbakin/sdk/patterns'
import { Button, Label, Switch, SystemState } from '@makinbakin/sdk/ui'
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
  const [retryNonce, setRetryNonce] = useState(0)
  // ⌘K lesson hits deep-link here as ?tab=lessons&lessonId=<id>; the
  // matching card gets a highlight ring and scrolls into view ONCE per
  // highlight id — `lessons` also changes on every optimistic toggle
  // update, and re-scrolling mid-interaction would yank the viewport.
  const [highlightId] = useQueryState('lessonId', '')
  const highlightRef = useRef<HTMLLIElement | null>(null)
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
      setLessons(null)
      setError(null)
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
  }, [agentId, retryNonce])

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
      <SystemState
        kind="error"
        scope="page"
        headingLevel={3}
        title="Lessons could not be loaded"
        description={error}
        action={(
          <Button variant="outline" size="sm" onClick={() => setRetryNonce((value) => value + 1)}>
            Retry
          </Button>
        )}
      />
    )
  }
  if (lessons === null) {
    return (
      <SystemState
        kind="loading"
        scope="page"
        headingLevel={3}
        title="Loading lessons"
        description="Package lessons will appear when they are ready."
      />
    )
  }
  if (lessons.length === 0) {
    return (
      <SystemState
        kind="initial-empty"
        scope="page"
        headingLevel={3}
        title="No lessons available"
        description="This package does not currently provide lessons for the agent."
      />
    )
  }

  return (
    <Section spacing="compact" aria-labelledby="package-lessons-heading">
      <Stack gap="dense">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
          <div className="min-w-0">
            <h2 id="package-lessons-heading">Lessons</h2>
            <p className="m-0 mt-bakin-1 max-w-prose text-bakin-text-muted">
              Learned from real tasks — the most relevant lessons are recalled automatically per task.
              Hard rules belong in Identity and AGENTS.md instead.
            </p>
          </div>
          {packageId ? (
            <code className="max-w-full truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
              {packageId}
            </code>
          ) : null}
        </div>

        <ListRows aria-label="Agent lessons">
          {lessons.map((lesson) => {
            const highlighted = highlightId !== '' && lesson.lessonId === highlightId
            const switchId = `lesson-${agentId}-${lesson.lessonId}`
            return (
              <ListRow
                key={lesson.lessonId}
                ref={highlighted ? highlightRef : undefined}
                data-highlighted={highlighted ? 'true' : undefined}
                selected={highlighted}
                className="flex flex-col gap-bakin-3 sm:flex-row sm:items-center"
              >
                <Label
                  htmlFor={switchId}
                  className="flex min-w-0 flex-1 cursor-pointer items-start gap-bakin-2"
                >
                  <FileText aria-hidden="true" className="mt-bakin-1 size-bakin-4 shrink-0 text-bakin-text-muted" />
                  <span className="min-w-0">
                    <span
                      className={`block truncate font-bakin-typography-family-mono text-bakin-typography-size-body ${
                        lesson.enabled ? 'text-bakin-text-primary' : 'text-bakin-text-muted'
                      }`}
                    >
                      {lesson.lessonId}
                    </span>
                    <span className="mt-bakin-1 block truncate text-bakin-typography-size-meta font-normal text-bakin-text-muted">
                      {lesson.title}
                      {lesson.tags.length > 0 ? ` · ${lesson.tags.join(', ')}` : ''}
                    </span>
                  </span>
                </Label>

                <div className="flex items-center justify-between gap-bakin-3 sm:justify-end">
                  {pendingId === lesson.lessonId ? (
                    <Loader2
                      aria-label={`Updating ${lesson.title}`}
                      className="size-bakin-4 animate-spin text-bakin-text-muted motion-reduce:animate-none"
                    />
                  ) : null}
                  <Label htmlFor={switchId} className="text-bakin-text-muted">
                    <span className="text-bakin-typography-size-meta">
                      {lesson.enabled ? 'Active' : 'Inactive'}
                    </span>
                  </Label>
                  <Switch
                    id={switchId}
                    size="sm"
                    checked={lesson.enabled}
                    onCheckedChange={(next: boolean) => void toggle(lesson.lessonId, next)}
                    disabled={pendingId !== null}
                    aria-label={`Toggle ${lesson.title}`}
                  />
                </div>
              </ListRow>
            )
          })}
        </ListRows>
      </Stack>
    </Section>
  )
}
