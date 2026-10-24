'use client'

/**
 * The recover view's EDITOR (self-healing PR1, Codex r1 #7; rows 127/128,
 * 133–137): the raw file behind a workflow record Health flagged — a
 * definition whose YAML does not parse or carries a key the schema refuses,
 * a skill missing its frontmatter or `output_schema`. Identity-addressable
 * (the record id is the route), opened at the line the finding points to,
 * saved through the workflows plugin's raw routes (which refuse a save that
 * is still broken, naming the line or the key), and followed by a targeted
 * rerun of the originating Health check.
 *
 * Patterns: SaveBar (Components/Forms/SaveBar — CanonicalUsage) over a
 * Field + Textarea (Components/Forms/Field and form composition;
 * Components/Primitives/Textarea — CanonicalUsage).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { SaveBar } from '@makinbakin/sdk/patterns'
import { Banner, Field, FieldControl, FieldDescription, FieldLabel, Skeleton, Textarea } from '@makinbakin/sdk/ui'
import { locateSkillSectionLine, locateYamlLine } from '../lib/yaml-locate'

export type RecoverEditorTarget =
  | { kind: 'definition'; id: string }
  | { kind: 'skill'; file: string }

export interface RecoverEditorFocus {
  /** A dotted YAML path the finding names (definitions). */
  path?: string | null
  /** A 1-based line the finding names (a parse error). */
  line?: number | null
  /** The skill section the finding names. */
  section?: 'frontmatter' | 'output_schema' | null
}

export interface WorkflowRecoverEditorProps {
  target: RecoverEditorTarget
  focus?: RecoverEditorFocus | null
  /** The save landed and the originating check was asked to rerun. */
  onSaved?: () => void
}

interface RawDefinition { id: string; source: string; path: string | null; yaml: string; parseError?: { message: string; line: number | null }; shadowsOnSave?: boolean }
interface RawSkill { name: string; path: string; content: string; problems: Array<{ section: 'frontmatter' | 'output_schema'; message: string }> }

type Recheck = 'idle' | 'requested' | 'done' | 'failed'

const rawUrl = (target: RecoverEditorTarget): string => target.kind === 'definition'
  ? `/api/plugins/workflows/definitions/${encodeURIComponent(target.id)}/raw`
  : `/api/plugins/workflows/skills/${encodeURIComponent(target.file)}/raw`

const checkIdFor = (target: RecoverEditorTarget): string => target.kind === 'definition' ? 'workflows.definitions' : 'workflows.skills'

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : fallback
}

/** Ask Health to rerun ONLY the originating check (the return half of the recover flow). */
async function recheck(target: RecoverEditorTarget): Promise<boolean> {
  try {
    const res = await fetch('/api/plugins/health/doctor/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkIds: [checkIdFor(target)] }),
    })
    return res.ok
  } catch {
    return false
  }
}

export function WorkflowRecoverEditor({ target, focus, onSaved }: WorkflowRecoverEditorProps) {
  // The loaded file is keyed by its target: a new target simply has no file
  // yet (loading), so the effect never resets state synchronously.
  const targetKey = target.kind === 'definition' ? `definition:${target.id}` : `skill:${target.file}`
  const [file, setFile] = useState<{ key: string; loaded: string; note: string | null; cursorLine: number | null } | null>(null)
  const [loadFailure, setLoadFailure] = useState<{ key: string; message: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [recheckState, setRecheckState] = useState<Recheck>('idle')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const current = file?.key === targetKey ? file : null
  const loaded = current?.loaded ?? null
  const note = current?.note ?? null
  const cursorLine = current?.cursorLine ?? null
  const loadError = loadFailure?.key === targetKey ? loadFailure.message : null

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const key = targetKey
    void fetch(rawUrl(target), { signal: controller.signal }).then(async (res) => {
      if (!active) return
      if (!res.ok) { setLoadFailure({ key, message: await readError(res, `The file could not be read (${res.status}).`) }); return }
      if (target.kind === 'definition') {
        const body = await res.json() as RawDefinition
        if (!active) return
        setFile({
          key,
          loaded: body.yaml,
          cursorLine: focus?.line ?? body.parseError?.line ?? locateYamlLine(body.yaml, focus?.path),
          note: body.parseError
            ? `The file does not parse${body.parseError.line ? ` at line ${body.parseError.line}` : ''}: ${body.parseError.message}`
            : body.shadowsOnSave ? 'This is a managed definition. Saving writes a custom copy with the same id that takes precedence.' : null,
        })
        setDraft(body.yaml)
      } else {
        const body = await res.json() as RawSkill
        if (!active) return
        const section = focus?.section ?? body.problems[0]?.section ?? null
        setFile({
          key,
          loaded: body.content,
          cursorLine: locateSkillSectionLine(body.content, section),
          note: body.problems.length > 0 ? body.problems.map((problem) => problem.message).join(' ') : null,
        })
        setDraft(body.content)
      }
      setRecheckState('idle')
    }).catch((err: unknown) => {
      if (!active || (err instanceof Error && err.name === 'AbortError')) return
      setLoadFailure({ key, message: err instanceof Error ? err.message : String(err) })
    })
    return () => { active = false; controller.abort() }
  }, [targetKey, focus?.path, focus?.line, focus?.section]) // eslint-disable-line react-hooks/exhaustive-deps

  // Land the cursor on the finding's line once the text is in the textarea.
  useEffect(() => {
    const element = textareaRef.current
    if (loaded === null || cursorLine === null || !element) return
    const lines = loaded.split('\n')
    const start = lines.slice(0, cursorLine - 1).reduce((sum, line) => sum + line.length + 1, 0)
    const end = start + (lines[cursorLine - 1]?.length ?? 0)
    try {
      element.focus({ preventScroll: true })
      element.setSelectionRange(start, end)
    } catch {
      // A detached or read-only control cannot take a selection; the line number in the description still says where.
    }
  }, [loaded, cursorLine])

  const save = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    setRecheckState('idle')
    try {
      const res = await fetch(rawUrl(target), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target.kind === 'definition' ? { yaml: draft } : { content: draft }),
      })
      if (!res.ok) { setSaveError(await readError(res, `Save failed (${res.status}).`)); return }
      setFile((previous) => (previous && previous.key === targetKey ? { ...previous, loaded: draft, note: null } : previous))
      setRecheckState('requested')
      const ok = await recheck(target)
      setRecheckState(ok ? 'done' : 'failed')
      onSaved?.()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [draft, onSaved, target, targetKey])

  if (loadError) {
    return <Banner tone="danger" title="The file could not be opened" description={loadError} data-testid="workflow-recover-editor-error" />
  }
  if (loaded === null) {
    return (
      <div className="grid min-w-0 gap-bakin-2" data-testid="workflow-recover-editor-loading">
        <Skeleton className="h-bakin-8 w-full" />
        <Skeleton className="h-bakin-8 w-full" />
        <Skeleton className="h-bakin-8 w-3/4" />
      </div>
    )
  }

  const label = target.kind === 'definition' ? `${target.id}.yaml` : target.file
  const where = cursorLine !== null
    ? `Health points at line ${cursorLine}${focus?.path ? ` (${focus.path})` : focus?.section ? ` (${focus.section})` : ''}; the cursor starts there.`
    : 'Edit the file as it is on disk; a save that is still broken is refused with the reason.'
  const recheckCopy = recheckState === 'done'
    ? 'Health rechecked this record.'
    : recheckState === 'failed'
      ? 'Saved, but Health could not be asked to recheck — run checks from the Health page.'
      : recheckState === 'requested' ? 'Asking Health to recheck…' : null

  return (
    <div className="grid min-w-0 gap-bakin-3" data-testid="workflow-recover-editor">
      {note ? <Banner tone="attention" title={target.kind === 'definition' ? 'What is wrong with this file' : 'What the skill is missing'} description={note} /> : null}
      <Field name="raw-record">
        <FieldLabel>{label}</FieldLabel>
        <FieldDescription>{where}</FieldDescription>
        <FieldControl
          render={(
            <Textarea
              ref={textareaRef}
              autoSize
              minRows={12}
              maxRows={40}
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="font-bakin-typography-family-mono text-bakin-typography-size-meta"
              data-testid="workflow-recover-editor-text"
            />
          )}
        />
      </Field>
      <SaveBar
        dirty={draft !== loaded}
        saving={saving}
        error={saveError}
        saveLabel="Save and recheck"
        savedLabel={recheckCopy ?? 'Saved'}
        savedAnnouncement="Record saved"
        savedDurationMs={6000}
        onSave={() => { void save() }}
        onDiscard={() => { setDraft(loaded); setSaveError(null) }}
      >
        <span>{target.kind === 'definition' ? 'Raw YAML edit' : 'Raw skill edit'}</span>
      </SaveBar>
    </div>
  )
}
