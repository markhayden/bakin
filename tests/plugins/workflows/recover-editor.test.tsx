/**
 * The workflow recover view (self-healing PR1 slice 1.4b + Codex r1 #7;
 * rows 127–137): Health's findings for ONE record read from the cached
 * report, and the raw editor that fixes it in place — opened where the
 * finding points, saved through the raw routes, refused with the reason
 * while still broken, followed by a targeted recheck of the originating
 * check.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => <a href={to} className={className}>{children}</a>,
}))

import { WorkflowRecoverBanner, WorkflowRecoverView, stableKey } from '../../../plugins/workflows/components/workflow-recover-banner'
import { WorkflowRecoverEditor } from '../../../plugins/workflows/components/workflow-recover-editor'

const brokenYaml = 'name: Launch notes\nsteps:\n  - id: draft\n    label: Draft\n    bogus: 1\n'
const report = {
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
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  rawDefinition = { id: 'launch-notes', source: 'user', path: '/x/launch-notes.yaml', yaml: brokenYaml }
  rawSkill = { name: 'review.md', path: '/x/review.md', content: 'just a body\n', problems: [{ section: 'frontmatter', message: 'The file has no YAML frontmatter (a `---` block at the top).' }, { section: 'output_schema', message: 'The frontmatter declares no `output_schema`.' }] }
  putStatus = 200
  putBody = { saved: true }
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/plugins/health/doctor') return Response.json(report)
    if (url === '/api/plugins/health/doctor/run') return Response.json({ id: 'r2' })
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
  it('a record Health has nothing on is a quiet success', async () => {
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'workflow', id: 'other' }} onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health has nothing open on this record')).toBeTruthy())
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
})
