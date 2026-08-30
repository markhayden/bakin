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
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Inline, Panel } from '@makinbakin/sdk/layout'
import { ListRow, ListRows, StatusBadge } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  DrawerSection,
  Banner,
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Form,
  FormActions,
  Input,
  Text,
  Textarea,
  buttonVariants,
} from '@makinbakin/sdk/ui'

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
    <DrawerSection
      title="Brand context"
      actions={(
        <PluginLink
          to={`/brands/${encodeURIComponent(brand.brandId)}`}
          className={buttonVariants({ variant: 'link', size: 'xs' })}
        >
          Open brand
        </PluginLink>
      )}
    >
      <div className="grid gap-bakin-4">
        <Inline gap="dense">
          <p className="m-0 min-w-0 font-bakin-typography-weight-semibold text-bakin-text-primary">
            {brand.name || brand.brandId}
          </p>
          <StatusBadge size="xs" tone="accent">{SOURCE_LABEL[brand.source]}</StatusBadge>
        </Inline>

        {brand.blocked ? (
          <Banner
            tone="attention"
            headingLevel={4}
            title="Brand unavailable"
            description="Dispatch is waiting until this brand is published and available."
            action={(
              <PluginLink
                to={`/brands/${encodeURIComponent(brand.brandId)}`}
                className={buttonVariants({ variant: 'outline', size: 'xs' })}
              >
                Review brand
              </PluginLink>
            )}
          />
        ) : null}

        {injections.length > 0 ? (
          <div className="grid gap-bakin-2">
            <Text size="meta" tone="muted" weight="semibold" as="p">
              Recent injections
            </Text>
            <ListRows variant="separated" size="sm" aria-label="What the agent saw">
              {injections.slice(0, 5).map((inj, i) => (
                <ListRow key={inj.runId || i} className="grid gap-bakin-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-bakin-2 gap-y-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
                    <span>{inj.ts ? new Date(inj.ts).toLocaleString() : 'Unknown time'}</span>
                    <span>{inj.agent || 'Unknown agent'}</span>
                    <span className="font-bakin-typography-family-mono">{inj.cardBytes ?? 0} B</span>
                    {inj.lessonsIncluded?.length ? <span>{inj.lessonsIncluded.length} lesson(s)</span> : null}
                  </div>
                  {inj.omitted?.length || inj.warnings?.length ? (
                    <div className="flex min-w-0 flex-wrap gap-bakin-1">
                      {inj.omitted?.length ? (
                        <StatusBadge size="xs" tone="attention">
                          {inj.omitted.length} omitted for size
                        </StatusBadge>
                      ) : null}
                      {inj.warnings?.length ? (
                        <StatusBadge size="xs" tone="attention">Missing assets</StatusBadge>
                      ) : null}
                    </div>
                  ) : null}
                </ListRow>
              ))}
            </ListRows>
          </div>
        ) : !brand.blocked ? (
          <Text size="meta" tone="muted" as="p" className="leading-relaxed">
            No dispatches yet. The brand card will inject on the next run.
          </Text>
        ) : null}

        {/* Quick-add lesson (#419 §6): close the correction loop from the task
            itself — no trip to the Brands page. */}
        {!lessonOpen ? (
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => { setLessonOpen(true); setLessonState('idle') }}
          >
            Save as brand lesson
          </Button>
        ) : (
          <Form
            aria-label="Save as brand lesson"
            busy={lessonState === 'saving'}
            onSubmit={async (event) => {
              event.preventDefault()
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
            <FieldGroup>
              <Field name="lesson-title">
                <FieldLabel htmlFor="brand-lesson-title" requirement="required">Lesson title</FieldLabel>
                <FieldDescription>Make the reusable guidance easy to recognize.</FieldDescription>
                <Input
                  id="brand-lesson-title"
                  required
                  placeholder="e.g. Prefer concrete launch copy"
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                />
              </Field>
              <Field name="lesson-guidance">
                <FieldLabel htmlFor="brand-lesson-guidance" requirement="required">Lesson guidance</FieldLabel>
                <FieldDescription>Describe what happened and what to do instead.</FieldDescription>
                <Textarea
                  id="brand-lesson-guidance"
                  required
                  rows={3}
                  placeholder="Absolute always-rules belong in the brand's Rules list."
                  value={lessonBody}
                  onChange={(e) => setLessonBody(e.target.value)}
                />
              </Field>
            </FieldGroup>
            {lessonState === 'error' ? (
              <Alert tone="danger">
                <AlertTitle>Lesson could not be saved</AlertTitle>
                <AlertDescription>Try again. Your draft remains in this form.</AlertDescription>
              </Alert>
            ) : null}
            <FormActions>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLessonOpen(false)}
                disabled={lessonState === 'saving'}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!lessonTitle.trim() || !lessonBody.trim() || lessonState === 'saving'}
              >
                {lessonState === 'saving' ? 'Saving…' : 'Save lesson'}
              </Button>
            </FormActions>
          </Form>
        )}
        {lessonState === 'saved' && !lessonOpen ? (
          <Alert tone="success">
            <AlertTitle>Lesson saved</AlertTitle>
            <AlertDescription>It will inject on relevant future dispatches.</AlertDescription>
          </Alert>
        ) : null}

        {debug ? (
          <div className="grid gap-bakin-2">
            {preview === null ? (
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => void loadPreview()}
              >
                Render current card
              </Button>
            ) : (
              <Panel
                variant="code"
                padding="compact"
                scroll
                aria-label="Rendered brand card preview"
                className="max-h-64 text-bakin-text-muted"
              >
                <pre>{preview}</pre>
              </Panel>
            )}
          </div>
        ) : null}
      </div>
    </DrawerSection>
  )
}
