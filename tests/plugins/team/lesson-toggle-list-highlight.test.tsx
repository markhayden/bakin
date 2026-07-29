// @vitest-environment jsdom
/**
 * LessonToggleList — ?lessonId= deep-link highlight.
 *
 * A ⌘K lesson hit lands on /team/<agent>?tab=lessons&lessonId=<id>; the
 * matching lesson card is marked highlighted (and scrolled into view).
 * Unknown or absent lessonId → no card highlighted, normal render.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import '../../rtl-settle'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-lesson-highlight',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

// Primed URL state, following the agent-detail-lessons-tab pattern.
const queryState: { lessonId: string } = { lessonId: '' }
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) =>
    key === 'lessonId' ? [queryState.lessonId || defaultValue, mock(), mock()] : [defaultValue, mock(), mock()],
  useQueryArrayState: () => [[], mock()],
}))

import { LessonToggleList } from '../../../plugins/team/components/lesson-toggle-list'

const LESSONS = [
  { lessonId: 'style', title: 'Style guide', tags: [], defaultEnabled: true, enabled: true },
  { lessonId: 'tone', title: 'Tone of voice', tags: [], defaultEnabled: true, enabled: false },
]

const scrollSpy = mock()

beforeEach(() => {
  queryState.lessonId = ''
  scrollSpy.mockClear()
  Element.prototype.scrollIntoView = scrollSpy
  ;(globalThis as Record<string, unknown>).fetch = mock(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, packageId: 'pixel@0.1.0', lessons: LESSONS }),
    } as Response),
  )
})

afterEach(() => {
  cleanup()
})

describe('LessonToggleList ?lessonId= highlight', () => {
  it('highlights the matching lesson card', async () => {
    queryState.lessonId = 'tone'
    render(<LessonToggleList agentId="pixel" />)
    await waitFor(() => expect(screen.getByText('Tone of voice')).toBeTruthy())
    const highlighted = document.querySelectorAll('[data-highlighted="true"]')
    expect(highlighted.length).toBe(1)
    expect(highlighted[0]!.textContent).toContain('Tone of voice')
    expect(screen.getByRole('list', { name: 'Agent lessons' }).getAttribute('data-variant')).toBe('bordered')
    expect(highlighted[0]!.getAttribute('data-slot')).toBe('list-row')
  })

  it('highlights nothing when the param is absent', async () => {
    render(<LessonToggleList agentId="pixel" />)
    await waitFor(() => expect(screen.getByText('Style guide')).toBeTruthy())
    expect(document.querySelectorAll('[data-highlighted="true"]').length).toBe(0)
  })

  it('scrolls to the highlighted card ONCE — not again on optimistic toggle updates', async () => {
    queryState.lessonId = 'tone'
    render(<LessonToggleList agentId="pixel" />)
    await waitFor(() => expect(screen.getByText('Tone of voice')).toBeTruthy())
    await waitFor(() => expect(scrollSpy.mock.calls.length).toBe(1))

    // Flipping any switch triggers an optimistic setLessons — the effect
    // re-runs but must NOT yank the viewport back to the highlighted card.
    fireEvent.click(screen.getByLabelText('Toggle Style guide'))
    await waitFor(() => expect(screen.getByLabelText('Toggle Style guide')).toBeTruthy())
    expect(scrollSpy.mock.calls.length).toBe(1)
  })

  it('re-arms the scroll when the param clears — revisiting the same lesson scrolls again', async () => {
    queryState.lessonId = 'tone'
    const { rerender } = render(<LessonToggleList agentId="pixel" />)
    await waitFor(() => expect(scrollSpy.mock.calls.length).toBe(1))

    // Param cleared (user dismissed / navigated within the page)…
    queryState.lessonId = ''
    rerender(<LessonToggleList agentId="pixel" />)
    // …then a fresh deep link to the SAME lesson must scroll again.
    queryState.lessonId = 'tone'
    rerender(<LessonToggleList agentId="pixel" />)
    await waitFor(() => expect(scrollSpy.mock.calls.length).toBe(2))
  })

  it('renders normally when the lessonId is unknown', async () => {
    queryState.lessonId = 'does-not-exist'
    render(<LessonToggleList agentId="pixel" />)
    await waitFor(() => expect(screen.getByText('Style guide')).toBeTruthy())
    expect(document.querySelectorAll('[data-highlighted="true"]').length).toBe(0)
  })
})
