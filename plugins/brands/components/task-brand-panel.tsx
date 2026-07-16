/**
 * Task Brand panel (#419, spec §5.5) — rendered into the task detail via the
 * 'task-brand' slot (same pattern as the assets plugin's 'task-assets').
 *
 * Shows the task's effective brand with provenance (own / inherited from
 * parent / project), its blocked state, the recent brand.injected records
 * ("what the agent actually saw"), and — in debug mode — the rendered card a
 * dispatch would get right now. Turns "why was this off-brand?" into a
 * lookup instead of an argument.
 */
import { useEffect, useState } from 'react'
import { useDebug, useJsonFetch } from '@makinbakin/sdk/hooks'
import { PluginLink } from '@makinbakin/sdk/components'

interface TaskBrandInfo {
  brandId: string
  source: 'own' | 'parent' | 'project'
  blocked: boolean
  name?: string
}

interface InjectionRecord {
  ts?: string
  agent?: string
  runId?: string
  cardBytes?: number
  sectionsIncluded?: string[]
  lessonsIncluded?: string[]
  omitted?: Array<{ item: string; reason: string }>
  warnings?: string[]
}

const SOURCE_LABEL: Record<TaskBrandInfo['source'], string> = {
  own: 'set on this task',
  parent: 'inherited from parent task',
  project: 'inherited from project',
}

export function TaskBrandPanel({ taskId }: { taskId?: string }) {
  const [debug] = useDebug()
  const [preview, setPreview] = useState<string | null>(null)
  const [lessonOpen, setLessonOpen] = useState(false)
  const [lessonTitle, setLessonTitle] = useState('')
  const [lessonBody, setLessonBody] = useState('')
  const [lessonState, setLessonState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const { data: contextData } = useJsonFetch<{ brand: TaskBrandInfo | null }>(
    taskId ? `/api/plugins/brands/task-context/${taskId}` : null,
  )
  const brand = contextData?.brand ?? null
  const { data: injectionsData } = useJsonFetch<{ injections: InjectionRecord[] }>(
    brand && taskId ? `/api/plugins/brands/injections/${taskId}` : null,
  )
  const injections = injectionsData?.injections ?? []

  useEffect(() => {
    setPreview(null)
  }, [taskId])

  if (!taskId || !brand) return null

  const loadPreview = async () => {
    try {
      const res = await fetch(`/api/plugins/brands/${brand.brandId}/card-preview`)
      if (!res.ok) {
        setPreview('(card unavailable — brand missing or draft)')
        return
      }
      const body = (await res.json()) as { card: string; meta: { cardBytes: number }; maxBytes: number }
      setPreview(`— ${body.meta.cardBytes} B of ${body.maxBytes} B budget —\n\n${body.card}`)
    } catch {
      setPreview('(card preview failed)')
    }
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-fuchsia-500/50" />
          <span className="text-sm font-medium">{brand.name || brand.brandId}</span>
          <span className="text-xs text-muted-foreground">({SOURCE_LABEL[brand.source]})</span>
        </div>
        {brand.blocked && (
          <PluginLink to="/brands" className="text-xs font-medium text-amber-400 hover:underline">
            brand unavailable — dispatch is waiting
          </PluginLink>
        )}
      </div>

      {injections.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Brand injections (what the agent saw)</p>
          {injections.slice(0, 5).map((inj, i) => (
            <div key={inj.runId || i} className="text-xs text-muted-foreground">
              {inj.ts ? new Date(inj.ts).toLocaleString() : ''} · {inj.agent} · {inj.cardBytes} B
              {inj.lessonsIncluded?.length ? ` · ${inj.lessonsIncluded.length} lesson(s)` : ''}
              {inj.omitted?.length ? (
                <span className="text-amber-400/80"> · {inj.omitted.length} omitted for size</span>
              ) : ''}
              {inj.warnings?.length ? (
                <span className="text-amber-400/80"> · ⚠ missing assets</span>
              ) : ''}
            </div>
          ))}
        </div>
      )}
      {injections.length === 0 && !brand.blocked && (
        <p className="mt-1 text-xs text-muted-foreground">No dispatches yet — the brand card will inject on the next run.</p>
      )}

      {/* Quick-add lesson (#419 §6): close the correction loop from the task
          itself — no trip to the Brands page. */}
      <div className="mt-2">
        {!lessonOpen ? (
          <button
            className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => { setLessonOpen(true); setLessonState('idle') }}
          >
            Save as brand lesson
          </button>
        ) : (
          <div className="space-y-1.5">
            <input
              className="w-full rounded-md border bg-background px-2 py-1 text-xs"
              placeholder="Lesson title (e.g. Never use threads on LinkedIn)"
              value={lessonTitle}
              onChange={(e) => setLessonTitle(e.target.value)}
            />
            <textarea
              className="w-full rounded-md border bg-background px-2 py-1 text-xs"
              rows={3}
              placeholder="What happened on this task, and what to do instead. (Absolute always-rules belong in the brand's Rules list.)"
              value={lessonBody}
              onChange={(e) => setLessonBody(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                disabled={!lessonTitle.trim() || !lessonBody.trim() || lessonState === 'saving'}
                onClick={async () => {
                  setLessonState('saving')
                  try {
                    // Append-only route — never overwrites a same-slug lesson.
                    const res = await fetch(
                      `/api/plugins/brands/${brand.brandId}/lessons`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: lessonTitle.trim(), body: lessonBody.trim() }),
                      },
                    )
                    if (!res.ok) throw new Error(String(res.status))
                    setLessonState('saved')
                    setLessonOpen(false)
                    setLessonTitle('')
                    setLessonBody('')
                  } catch {
                    setLessonState('error')
                  }
                }}
              >
                {lessonState === 'saving' ? 'Saving…' : 'Save lesson'}
              </button>
              <button className="text-xs text-muted-foreground hover:underline" onClick={() => setLessonOpen(false)}>
                Cancel
              </button>
              {lessonState === 'error' && <span className="text-xs text-destructive">save failed</span>}
            </div>
          </div>
        )}
        {lessonState === 'saved' && !lessonOpen && (
          <p className="mt-1 text-xs text-muted-foreground">Lesson saved — it will inject on relevant future dispatches.</p>
        )}
      </div>

      {debug && (
        <div className="mt-2">
          {preview === null ? (
            <button
              className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
              onClick={() => void loadPreview()}
            >
              Render current card (debug)
            </button>
          ) : (
            <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted/40 p-2 text-[11px] whitespace-pre-wrap">{preview}</pre>
          )}
        </div>
      )}
    </div>
  )
}
