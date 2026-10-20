'use client'

import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useKeyedState } from '@makinbakin/sdk/hooks'
import { useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'
import { AgentSelect, type AgentSelectOption } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Form,
  FormActions,
  Input,
  SubmitButton,
  Text,
} from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'
import type { OrgTeam } from '../types'

export type TeamFormMode = { kind: 'create' } | { kind: 'edit'; teamId: string }

export interface TeamFormDialogProps {
  open: boolean
  mode: TeamFormMode
  agents: readonly AgentSelectOption[]
  /** The runtime's main agent — what a persisted `reportsTo: null` means. */
  mainAgentId: string | null
  /** The Add / Edit control that opened the dialog; focus returns there on exit. */
  triggerRef: RefObject<HTMLElement | null>
  onClose: () => void
  /** The change landed; the caller reloads the roster. */
  onSaved: () => void
}

interface Draft {
  label: string
  id: string
  /** Agent id as picked ('' = none picked). The main agent stands for `null`. */
  reportsTo: string
}

/** Derived team ID: lowercase letters, digits and dashes. */
function deriveTeamId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Create or edit an org team (#758). The draft baseline is captured ONCE per
 * opening — roster reloads while the dialog is open never reset edits — and
 * dirty exits (Esc, Cancel, overlay, close icon, router navigation, unload)
 * go through the kit's unsaved-changes guard.
 */
export function TeamFormDialog({ open, mode, agents, mainAgentId, triggerRef, onClose, onSaved }: TeamFormDialogProps) {
  // Capture the baseline once per opening. `agents`/`mainAgentId` are read at
  // open time on purpose: a roster refresh mid-edit must not reset the form.
  // The form is keyed by the opening (#966b): a create starts from its
  // initial draft in the same render it opens; an edit starts empty and the
  // effect below reads the raw team record.
  const openedFor = mode.kind === 'edit' ? `edit:${mode.teamId}` : 'create'
  const openingKey = `${open}\u0000${openedFor}`
  const createInitial = (): Draft | null => (open && mode.kind === 'create' ? { label: '', id: '', reportsTo: mainAgentId ?? '' } : null)
  const [baseline, setBaseline] = useKeyedState<Draft | null>(openingKey, createInitial)
  const [draft, setDraft] = useKeyedState<Draft | null>(openingKey, createInitial)
  const [idTouched, setIdTouched] = useKeyedState(openingKey, () => false)
  const [missingReportsTo, setMissingReportsTo] = useKeyedState<string | null>(openingKey, () => null)
  const [loadError, setLoadError] = useKeyedState<string | null>(openingKey, () => null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useKeyedState<string | null>(openingKey, () => null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const rosterRef = useRef({ agents, mainAgentId })
  rosterRef.current = { agents, mainAgentId }
  useEffect(() => {
    if (!open || mode.kind !== 'edit') return
    let cancelled = false
    const { agents: roster, mainAgentId: main } = rosterRef.current
    // The RAW team record: the roster route maps a missing reports-to agent
    // to null (main), which would hide that it must be re-picked.
    void pluginFetch('team', 'teams')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load the team (${response.status})`)
        const body = await response.json() as { teams?: OrgTeam[] }
        const team = body.teams?.find((candidate) => candidate.id === mode.teamId)
        if (!team) throw new Error(`Team "${mode.teamId}" no longer exists.`)
        if (cancelled) return
        const known = team.reportsTo === null || roster.some((agent) => agent.id === team.reportsTo)
        const initial = {
          label: team.label,
          id: team.id,
          reportsTo: team.reportsTo === null ? (main ?? '') : known ? team.reportsTo : '',
        }
        if (!known) setMissingReportsTo(team.reportsTo)
        setBaseline(initial)
        setDraft(initial)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseline is per opening, keyed by what was opened
  }, [open, openedFor])

  // reportsTo compares on the PERSISTED value: the main agent is `null`.
  const persistedReportsTo = (value: string): string | null => (value === '' || value === mainAgentId ? null : value)
  const dirty = Boolean(draft && baseline && (
    draft.label !== baseline.label
    || (mode.kind === 'create' && draft.id !== baseline.id)
    || persistedReportsTo(draft.reportsTo) !== persistedReportsTo(baseline.reportsTo)
    || (missingReportsTo !== null && draft.reportsTo !== '')
  ))

  const trimmedLabel = draft?.label.trim() ?? ''
  const teamId = mode.kind === 'edit' ? mode.teamId : (draft?.id ?? '')
  // The pick is checked against the CURRENT roster (without resetting the
  // draft): an agent removed while the dialog is open must be re-picked.
  const pickedGone = Boolean(draft?.reportsTo) && !agents.some((agent) => agent.id === draft?.reportsTo)
  const goneAgent = pickedGone ? draft!.reportsTo : !draft?.reportsTo ? missingReportsTo : null
  const needsReportsTo = !draft?.reportsTo || pickedGone
  const canSave = Boolean(draft && trimmedLabel && teamId && !needsReportsTo && (mode.kind === 'create' || dirty))

  async function save(): Promise<boolean> {
    if (!draft || !canSave) return false
    setSaving(true)
    setSaveError(null)
    try {
      const reportsTo = persistedReportsTo(draft.reportsTo)
      const response = mode.kind === 'create'
        ? await pluginFetch('team', 'teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: teamId, label: trimmedLabel, reportsTo }),
        })
        : await pluginFetch('team', `teams/${encodeURIComponent(teamId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: trimmedLabel, reportsTo }),
        })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        setSaveError(body.error || `Could not save the team (${response.status}).`)
        return false
      }
      onSaved()
      return true
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  const guard = useUnsavedChangesGuard({
    hasUnsavedChanges: open && dirty,
    saving,
    saveDisabled: !canSave,
    onCancel: onClose,
    onSaveAndExit: save,
    onDiscardAndExit: () => {},
    error: saveError,
    saveLabel: mode.kind === 'create' ? 'Create and exit' : 'Save and exit',
    // "Stay" returns focus into the form; exiting moves it to the trigger.
    finalFocus: labelRef,
  })

  // The save resolves renders later than the submit that started it: read the
  // CURRENT guard (its reset sees a blocker opened mid-save), not the stale one.
  const guardRef = useRef(guard)
  guardRef.current = guard
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // A navigation attempted mid-save opened the guard's decision; the edit
    // is saved now, so dismiss that decision (the user stays) before closing.
    void save().then((saved) => { if (saved) { guardRef.current.reset(); onClose() } })
  }

  const update = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current))
  const title = mode.kind === 'create' ? 'Create a team' : 'Edit team'

  return (
    <Dialog
      open={open}
      busy={saving}
      onOpenChange={(next) => { if (!next) guard.requestExit() }}
    >
      <DialogContent finalFocus={triggerRef}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode.kind === 'create'
              ? 'A smaller reporting group with its own shared context.'
              : 'Rename the team or change who it reports to.'}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <Alert tone="danger">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        {draft ? (
          <Form busy={saving} onSubmit={handleSubmit} aria-label={title}>
            <FieldGroup>
              <Field name="teamLabel" invalid={draft.label !== '' && !trimmedLabel}>
                <FieldLabel htmlFor="team-label" requirement="required">Team name</FieldLabel>
                <FieldDescription>The visible name used throughout the org chart.</FieldDescription>
                <Input
                  id="team-label"
                  ref={labelRef}
                  value={draft.label}
                  onChange={(event) => {
                    const label = event.target.value
                    update(mode.kind === 'create' && !idTouched ? { label, id: deriveTeamId(label) } : { label })
                  }}
                  placeholder="e.g. Builders"
                  disabled={saving}
                  autoFocus
                />
                {draft.label !== '' && !trimmedLabel ? <FieldError match>Enter a team name.</FieldError> : null}
              </Field>

              <Field name="teamId">
                <FieldLabel htmlFor={mode.kind === 'create' ? 'team-id' : undefined}>Team ID</FieldLabel>
                {mode.kind === 'create' ? (
                  <>
                    <FieldDescription>Stable lowercase identifier used in routing and assignment.</FieldDescription>
                    <Input
                      id="team-id"
                      value={draft.id}
                      onChange={(event) => {
                        setIdTouched(true)
                        update({ id: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })
                      }}
                      placeholder="e.g. builders"
                      disabled={saving}
                      className="font-bakin-typography-family-mono"
                    />
                  </>
                ) : (
                  <>
                    <FieldDescription>Routing paths and team assignments key on it, so it can't change.</FieldDescription>
                    <Text size="meta" mono as="code" className="block break-all">{draft.id}</Text>
                  </>
                )}
              </Field>

              <Field name="reportsTo" invalid={goneAgent !== null}>
                <FieldLabel htmlFor="team-reports-to" requirement="required">Reports to</FieldLabel>
                <FieldDescription>The agent responsible for this team.</FieldDescription>
                <AgentSelect
                  id="team-reports-to"
                  value={draft.reportsTo}
                  onValueChange={(value) => update({ reportsTo: value })}
                  agents={agents}
                  placeholder="Select an agent"
                  disabled={saving}
                  className="w-full"
                />
                {goneAgent !== null ? (
                  <FieldError match>
                    {`"${goneAgent}" no longer exists — pick who this team reports to.`}
                  </FieldError>
                ) : null}
              </Field>
            </FieldGroup>

            {saveError ? (
              <Alert tone="danger">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}

            <FormActions>
              <Button type="button" variant="outline" size="sm" onClick={() => guard.requestExit()} disabled={saving}>
                Cancel
              </Button>
              <SubmitButton size="sm" disabled={!canSave} busyLabel={mode.kind === 'create' ? 'Creating…' : 'Saving…'}>
                {mode.kind === 'create' ? 'Create team' : 'Save changes'}
              </SubmitButton>
            </FormActions>
          </Form>
        ) : null}

        {guard.dialog}
      </DialogContent>
    </Dialog>
  )
}
