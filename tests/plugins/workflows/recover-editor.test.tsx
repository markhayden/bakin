/**
 * The workflow recover banner (self-healing PR1 slice 1.4b; rows 127–137):
 * Health's findings for ONE record, read from the cached report, with the
 * place to fix it — the editor for a definition, the file path for a skill.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => <a href={to} className={className}>{children}</a>,
}))

import { WorkflowRecoverBanner, stableKey } from '../../../plugins/workflows/components/workflow-recover-banner'

const report = {
  observations: [
    { id: 'workflows.definitions:skill-launch-notes-draft-write-copy', summary: 'Workflow launch-notes step draft references missing skill write-copy.' },
    { id: 'workflows.skills:frontmatter-review.md', summary: 'Workflow skill review.md has no YAML frontmatter.' },
  ],
  incidents: [
    { id: 'i1', title: 'A workflow step references a missing skill', impact: 'x', observationIds: ['workflows.definitions:skill-launch-notes-draft-write-copy'], resources: [{ kind: 'workflow', id: 'launch-notes' }] },
    { id: 'i2', title: 'A workflow skill has no frontmatter', impact: 'x', observationIds: ['workflows.skills:frontmatter-review.md'], resources: [{ kind: 'file', id: 'review.md' }] },
  ],
}
const realFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = mock(async () => Response.json(report)) as unknown as typeof fetch })
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('WorkflowRecoverBanner', () => {
  it('stableKey matches the health check\'s resource ids (underscores and dots survive, spaces do not)', () => {
    expect(stableKey('Launch Notes_v2.yaml')).toBe('launch-notes_v2.yaml')
  })
  it('lists the findings for THIS record only and links to its editor; Dismiss hands back', async () => {
    const onDismiss = mock()
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'workflow', id: 'launch-notes' }} editHref="/workflows/launch-notes/edit" editLabel="Open editor" onDismiss={onDismiss} />) })
    await waitFor(() => expect(screen.getByTestId('workflow-recover-banner')).toBeTruthy())
    expect(screen.getByText(/references missing skill write-copy/)).toBeTruthy()
    expect(screen.queryByText(/no YAML frontmatter/)).toBeNull()
    expect((screen.getByRole('link', { name: 'Open editor' }) as HTMLAnchorElement).getAttribute('href')).toBe('/workflows/launch-notes/edit')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss' })) })
    expect(onDismiss).toHaveBeenCalled()
  })
  it('a skill file names the path to fix on disk; a record Health has nothing on is a quiet success', async () => {
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'file', id: 'review.md' }} where="~/.bakin/workflows/skills/review.md" onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText(/no YAML frontmatter/)).toBeTruthy())
    expect(screen.getByText('~/.bakin/workflows/skills/review.md')).toBeTruthy()
    cleanup()
    await act(async () => { render(<WorkflowRecoverBanner resource={{ kind: 'workflow', id: 'other' }} onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health has nothing open on this record')).toBeTruthy())
  })
})
