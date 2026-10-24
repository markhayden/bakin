/**
 * The workflow recover view (self-healing PR1 slice 1.4b + Codex r1 #7;
 * rows 127–137): Health's findings for ONE record read from the cached
 * report, and the raw editor that fixes it in place — opened where the
 * finding points, saved through the raw routes, refused with the reason
 * while still broken, followed by a targeted recheck of the originating
 * check.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { useState } from 'react'
import { act, cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import '../../rtl-settle'

// The SDK guard's CONTRACT, in miniature (its own test pins the real router
// blocker): `requestExit` exits at once when clean, else opens the decision.
function FakeUnsavedChangesGuard() { return null }
mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => <a href={to} className={className}>{children}</a>,
  useUnsavedChangesGuard: (options: { hasUnsavedChanges: boolean; saving: boolean; title?: string; onCancel?: () => void; onSaveAndExit: () => Promise<boolean>; onDiscardAndExit: () => void }) => {
    const [open, setOpen] = useState(false)
    guardCalls.push({ hasUnsavedChanges: options.hasUnsavedChanges, saving: options.saving })
    const exit = () => { setOpen(false); options.onCancel?.() }
    return {
      requestExit: () => { if (options.hasUnsavedChanges) setOpen(true); else options.onCancel?.() },
      reset: () => setOpen(false),
      dialog: open ? (
        <div role="dialog" aria-label={String(options.title ?? 'Unsaved changes')} data-saving={options.saving ? 'true' : undefined}>
          <button type="button" disabled={options.saving} onClick={() => { void options.onSaveAndExit().then((ok) => { if (ok) exit() }) }}>Save and exit</button>
          <button type="button" disabled={options.saving} onClick={() => { options.onDiscardAndExit(); exit() }}>Discard changes</button>
          <button type="button" onClick={() => setOpen(false)}>Keep editing</button>
        </div>
      ) : <FakeUnsavedChangesGuard />,
    }
  },
}))
const guardCalls: Array<{ hasUnsavedChanges: boolean; saving: boolean }> = []

import { WorkflowRecoverBanner, WorkflowRecoverView, stableKey } from '../../../plugins/workflows/components/workflow-recover-banner'
import { WorkflowRecoverEditor } from '../../../plugins/workflows/components/workflow-recover-editor'

const brokenYaml = 'name: Launch notes\nsteps:\n  - id: draft\n    label: Draft\n    bogus: 1\n'
const observedChecks = [
  { checkId: 'workflows.definitions', latestExecution: { outcome: 'observed' } },
  { checkId: 'workflows.skills', latestExecution: { outcome: 'observed' } },
]
const report = {
  checks: observedChecks,
  observations: [
    { id: 'workflows.definitions:schema-launch-notes-0', summary: 'Workflow launch-notes has unknown YAML keys at steps.0: Unrecognized key: "bogus"', evidence: { path: 'steps.0.bogus' } },
    { id: 'workflows.skills:frontmatter-review.md', summary: 'Workflow skill review.md has no YAML frontmatter.', evidence: { section: 'frontmatter', inUse: false } },
  ],
  incidents: [
    { id: 'i1', title: 'Workflow launch-notes has unknown YAML keys', impact: 'x', declarationId: 'schema', observationIds: ['workflows.definitions:schema-launch-notes-0'], resources: [{ kind: 'workflow', id: 'launch-notes' }] },
    { id: 'i2', title: 'A workflow skill has no frontmatter', impact: 'x', declarationId: 'frontmatter', observationIds: ['workflows.skills:frontmatter-review.md'], resources: [{ kind: 'file', id: 'review.md' }] },
  ],
}

type Call = { url: string; method: string; body?: unknown }
let calls: Call[]
let rawDefinition: Record<string, unknown>
let rawSkill: Record<string, unknown>
let putStatus: number
let putBody: Record<string, unknown>
/** What the doctor read answers: the fixture report, an HTTP failure, a rejection, or a report with no checks observed. */
let doctorMode: 'ok' | 'http-error' | 'reject' | 'unverified'
/** A PUT that never settles (a save in flight). */
let putHangs: boolean
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  guardCalls.length = 0
  doctorMode = 'ok'
  putHangs = false
  rawDefinition = { id: 'launch-notes', source: 'user', path: '/x/launch-notes.yaml', yaml: brokenYaml }
  rawSkill = { name: 'review.md', path: '/x/review.md', content: 'just a body\n', problems: [{ section: 'frontmatter', message: 'The file has no YAML frontmatter (a `---` block at the top).' }, { section: 'output_schema', message: 'The frontmatter declares no `output_schema`.' }] }
  putStatus = 200
  putBody = { saved: true }
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/plugins/health/doctor') {
      if (doctorMode === 'http-error') return Response.json({ error: 'doctor unavailable' }, { status: 503 })
      if (doctorMode === 'reject') throw new TypeError('Failed to fetch')
      if (doctorMode === 'unverified') return Response.json({ checks: [], observations: [], incidents: [] })
      return Response.json(report)
    }
    if (url === '/api/plugins/health/doctor/run') return Response.json({ id: 'r2' })
    if (url.endsWith('/definitions/launch-notes/raw') && method === 'PUT' && putHangs) return new Promise<Response>(() => {})
    if (url.endsWith('/definitions/launch-notes/raw')) return method === 'GET' ? Response.json(rawDefinition) : Response.json(putBody, { status: putStatus })
    if (url.endsWith('/skills/review.md/raw')) return method === 'GET' ? Response.json(rawSkill) : Response.json(putBody, { status: putStatus })
    return Response.json({ error: `unexpected ${method} ${url}` }, { status: 500 })
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

const textarea = () => screen.getByTestId('workflow-recover-editor-text') as HTMLTextAreaElement
const lineAt = (text: string, selectionStart: number) => text.slice(0, selectionStart).split('\n').length

describe('WorkflowRecoverBanner', () => {
  it('stableKey matches the health check\'s resource ids (underscores and dots survive, spaces do not)', () => {
    expect(stableKey('Launch Notes_v2.yaml')).toBe('launch-notes_v2.yaml')
  })
  it('lists the findings for THIS record only, links to the canvas editor when given one; Dismiss hands back', async () => {
    const onDismiss = mock()
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'workflow', id: 'launch-notes' }} editHref="/workflows/launch-notes/edit" editLabel="Open canvas editor" onDismiss={onDismiss} />) })
    await waitFor(() => expect(screen.getByTestId('workflow-recover-banner')).toBeTruthy())
    expect(screen.getByText(/unknown YAML keys at steps\.0/)).toBeTruthy()
    expect(screen.queryByText(/no YAML frontmatter/)).toBeNull()
    expect((screen.getByRole('link', { name: 'Open canvas editor' }) as HTMLAnchorElement).getAttribute('href')).toBe('/workflows/launch-notes/edit')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    expect(onDismiss).toHaveBeenCalled()
  })
  it('a record Health has nothing on is a quiet success — ONLY when its check has observed in this report', async () => {
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'workflow', id: 'other' }} onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health has nothing open on this record')).toBeTruthy())
    expect(screen.getByTestId('workflow-recover-banner').getAttribute('data-evidence')).toBe('verified-empty')
  })
  it('a report whose check has not observed is UNVERIFIED, never "nothing open" (Codex r2 #10)', async () => {
    doctorMode = 'unverified'
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'workflow', id: 'other' }} onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health has not verified this record yet')).toBeTruthy())
    expect(screen.getByTestId('workflow-recover-banner').getAttribute('data-evidence')).toBe('unverified')
    expect(screen.queryByText('Health has nothing open on this record')).toBeNull()
  })
  it('a failed report read (HTTP error or rejection) is an honest unavailable state with Try again — never success (Codex r2 #10)', async () => {
    doctorMode = 'http-error'
    const onDismiss = mock()
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'workflow', id: 'launch-notes' }} onDismiss={onDismiss} />) })
    await waitFor(() => expect(screen.getByText('Health could not be read')).toBeTruthy())
    expect(screen.getByTestId('workflow-recover-banner').getAttribute('data-evidence')).toBe('unavailable')
    expect(screen.getByTestId('workflow-recover-banner').textContent).toContain('(503)')
    // Try again lands the findings once the report answers.
    doctorMode = 'ok'
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    await waitFor(() => expect(screen.getByText(/unknown YAML keys at steps\.0/)).toBeTruthy())
    expect(screen.getByTestId('workflow-recover-banner').getAttribute('data-evidence')).toBe('findings')
    cleanup()
    doctorMode = 'reject'
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'workflow', id: 'launch-notes' }} onDismiss={onDismiss} />) })
    await waitFor(() => expect(screen.getByText('Health could not be read')).toBeTruthy())
    expect(screen.getByTestId('workflow-recover-banner').textContent).toContain('Failed to fetch')
  })
  it('a failed REFRESH keeps the last known findings on screen and says the read failed (Codex r2 #10)', async () => {
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'workflow', id: 'launch-notes' }} onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText(/unknown YAML keys at steps\.0/)).toBeTruthy())
    doctorMode = 'http-error'
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    await waitFor(() => expect(screen.getByTestId('workflow-recover-banner').getAttribute('data-evidence')).toBe('stale'))
    expect(screen.getByText(/unknown YAML keys at steps\.0/)).toBeTruthy()
    expect(screen.getByTestId('workflow-recover-banner').textContent).toContain('Showing the last findings Health reported')
    expect(screen.queryByText('Health has nothing open on this record')).toBeNull()
  })
})

describe('WorkflowRecoverEditor — definition', () => {
  it('opens the raw file at the failing key, saves through the raw route, then asks Health to recheck ONLY the definitions check', async () => {
    const onSaved = mock()
    await act(async () => { render(<WorkflowRecoverEditor target={{ kind: 'definition', id: 'launch-notes' }} focus={{ path: 'steps.0.bogus' }} onSaved={onSaved} />) })
    await waitFor(() => expect(screen.getByTestId('workflow-recover-editor')).toBeTruthy())
    expect(textarea().value).toBe(brokenYaml)
    expect(screen.getByText(/Health points at line 5 \(steps\.0\.bogus\)/)).toBeTruthy()
    expect(lineAt(brokenYaml, textarea().selectionStart)).toBe(5)
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull() // nothing to save yet

    const fixed = brokenYaml.replace('    bogus: 1\n', '')
    await act(async () => { fireEvent.change(textarea(), { target: { value: fixed } }) })
    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    await act(async () => { fireEvent.click(within(bar).getByRole('button', { name: 'Save and recheck' })) })
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/plugins/workflows/definitions/launch-notes/raw', body: { yaml: fixed } })
    expect(calls.find((c) => c.url === '/api/plugins/health/doctor/run')).toMatchObject({ method: 'POST', body: { checkIds: ['workflows.definitions'] } })
    await waitFor(() => expect(screen.getByText('Health rechecked this record.')).toBeTruthy())
  })

  it('a file that does not parse opens at the parse line with the reason; a save still broken is refused with the route\'s words and nothing is rechecked', async () => {
    rawDefinition = { ...rawDefinition, yaml: 'name: torn\nsteps:\n  - id: s1\n    label: [unclosed\n', parseError: { message: 'unexpected end of the stream', line: 4 } }
    putStatus = 400
    putBody = { error: 'YAML does not parse at line 4: unexpected end of the stream', parseError: { line: 4 } }
    await act(async () => { render(<WorkflowRecoverEditor target={{ kind: 'definition', id: 'launch-notes' }} />) })
    await waitFor(() => expect(screen.getByTestId('workflow-recover-editor')).toBeTruthy())
    expect(screen.getByText(/does not parse at line 4: unexpected end of the stream/)).toBeTruthy()
    expect(lineAt(textarea().value, textarea().selectionStart)).toBe(4)
    await act(async () => { fireEvent.change(textarea(), { target: { value: 'name: torn\nsteps: [\n' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save and recheck' })) })
    await waitFor(() => expect(screen.getByRole('region', { name: 'Unsaved changes' }).getAttribute('data-savebar-state')).toBe('error'))
    expect(screen.getByText(/YAML does not parse at line 4/)).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/plugins/health/doctor/run')).toBe(false)
  })

  it('a file that cannot be read is an honest error, never an empty editor', async () => {
    globalThis.fetch = mock(async () => Response.json({ error: 'Definition not found' }, { status: 404 })) as unknown as typeof fetch
    await act(async () => { render(<WorkflowRecoverEditor target={{ kind: 'definition', id: 'launch-notes' }} />) })
    await waitFor(() => expect(screen.getByTestId('workflow-recover-editor-error').textContent).toContain('Definition not found'))
    expect(screen.queryByTestId('workflow-recover-editor-text')).toBeNull()
  })
})

describe('WorkflowRecoverEditor — skill', () => {
  it('opens at the section the finding names, shows what the skill is missing, saves and rechecks the skills check', async () => {
    rawSkill = { ...rawSkill, content: '---\nname: Review\n---\nbody\n', problems: [{ section: 'output_schema', message: 'The frontmatter declares no `output_schema`.' }] }
    await act(async () => { render(<WorkflowRecoverEditor target={{ kind: 'skill', file: 'review.md' }} focus={{ section: 'output_schema' }} />) })
    await waitFor(() => expect(screen.getByTestId('workflow-recover-editor')).toBeTruthy())
    expect(screen.getByText(/declares no `output_schema`/)).toBeTruthy()
    expect(lineAt(textarea().value, textarea().selectionStart)).toBe(3) // the closing fence: where the schema belongs
    await act(async () => { fireEvent.change(textarea(), { target: { value: '---\nname: Review\noutput_schema:\n  type: object\n---\nbody\n' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save and recheck' })) })
    await waitFor(() => expect(calls.find((c) => c.url === '/api/plugins/health/doctor/run')).toMatchObject({ body: { checkIds: ['workflows.skills'] } }))
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/api/plugins/workflows/skills/review.md/raw', body: { content: expect.stringContaining('output_schema') } })
  })
})

describe('WorkflowRecoverView', () => {
  it('composes the findings banner with the editor opened where the FIRST finding points (its evidence path)', async () => {
    await act(async () => { render(<WorkflowRecoverView resource={{ kind: 'workflow', id: 'launch-notes' }} target={{ kind: 'definition', id: 'launch-notes' }} onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByTestId('workflow-recover-view')).toBeTruthy())
    expect(screen.getByTestId('workflow-recover-banner').textContent).toContain('Fix it in the editor below')
    await waitFor(() => expect(screen.getByText(/Health points at line 5 \(steps\.0\.bogus\)/)).toBeTruthy())
  })
  it('a skill view lands on the section the finding names', async () => {
    await act(async () => { render(<WorkflowRecoverView resource={{ kind: 'file', id: 'review.md' }} target={{ kind: 'skill', file: 'review.md' }} onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText(/Health points at line 1 \(frontmatter\)/)).toBeTruthy())
  })
  it('the report unavailable still opens the editor (the file is readable on its own) under the honest banner', async () => {
    doctorMode = 'http-error'
    await act(async () => { render(<WorkflowRecoverView resource={{ kind: 'workflow', id: 'launch-notes' }} target={{ kind: 'definition', id: 'launch-notes' }} onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health could not be read')).toBeTruthy())
    await waitFor(() => expect(textarea().value).toBe(brokenYaml))
  })
})

describe('WorkflowRecoverView — unsaved repairs (Codex r2 #12)', () => {
  it('Dismiss with a clean draft hands back at once; with a dirty draft it asks first — Keep editing stays, Discard restores the file and hands back', async () => {
    const onDismiss = mock()
    await act(async () => { render(<WorkflowRecoverView resource={{ kind: 'workflow', id: 'launch-notes' }} target={{ kind: 'definition', id: 'launch-notes' }} onDismiss={onDismiss} />) })
    await waitFor(() => expect(textarea().value).toBe(brokenYaml))
    expect(guardCalls.at(-1)).toMatchObject({ hasUnsavedChanges: false, saving: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    expect(onDismiss).toHaveBeenCalledTimes(1)

    await act(async () => { fireEvent.change(textarea(), { target: { value: 'name: edited\n' } }) })
    expect(guardCalls.at(-1)).toMatchObject({ hasUnsavedChanges: true })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved repair' })
    expect(onDismiss).toHaveBeenCalledTimes(1) // not yet
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(textarea().value).toBe('name: edited\n')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    const again = await screen.findByRole('dialog', { name: 'Unsaved repair' })
    await act(async () => { fireEvent.click(within(again).getByRole('button', { name: 'Discard changes' })) })
    expect(onDismiss).toHaveBeenCalledTimes(2)
    expect(textarea().value).toBe(brokenYaml)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
  it('Save and exit from the decision saves through the raw route, rechecks, then hands back; while a save is in flight the guard reports saving', async () => {
    const onDismiss = mock()
    await act(async () => { render(<WorkflowRecoverView resource={{ kind: 'workflow', id: 'launch-notes' }} target={{ kind: 'definition', id: 'launch-notes' }} onDismiss={onDismiss} />) })
    await waitFor(() => expect(textarea().value).toBe(brokenYaml))
    const fixed = brokenYaml.replace('    bogus: 1\n', '')
    await act(async () => { fireEvent.change(textarea(), { target: { value: fixed } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved repair' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save and exit' })) })
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1))
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ body: { yaml: fixed } })
    expect(calls.find((c) => c.url === '/api/plugins/health/doctor/run')).toMatchObject({ body: { checkIds: ['workflows.definitions'] } })

    // A save in flight: the guard knows (its dialog disables the destructive choices while saving).
    cleanup()
    calls = []
    putHangs = true
    await act(async () => { render(<WorkflowRecoverView resource={{ kind: 'workflow', id: 'launch-notes' }} target={{ kind: 'definition', id: 'launch-notes' }} onDismiss={onDismiss} />) })
    await waitFor(() => expect(textarea().value).toBe(brokenYaml))
    await act(async () => { fireEvent.change(textarea(), { target: { value: fixed } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save and recheck' })) })
    await waitFor(() => expect(guardCalls.at(-1)).toMatchObject({ hasUnsavedChanges: true, saving: true }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    const saving = await screen.findByRole('dialog', { name: 'Unsaved repair' })
    expect(saving.getAttribute('data-saving')).toBe('true')
    expect((within(saving).getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
