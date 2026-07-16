// @vitest-environment jsdom
/**
 * useQueryState multi-setter batching (routing overhaul PR3, task 3.2).
 *
 * Historically each setter snapshotted the pre-navigation params and
 * navigated immediately, so two setters in one tick clobbered each other
 * (the "booted back to the launcher" bug) — the knowledge doc banned the
 * pattern and pages hand-rolled one-URL workarounds. Setters now enqueue
 * into a microtask batch: one navigation per tick carrying every update,
 * push winning over replace when any update pushed.
 */
import { describe, expect, it, mock, afterEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure URL-state hooks — no storage — resolvers mocked per the isolation rule.
const testDir = join(tmpdir(), `bakin-test-uqs-batching-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const navigations: Array<Record<string, unknown>> = []
mock.module('@tanstack/react-router', () => ({
  ...require('../shims/tanstack-router'),
  useNavigate: () => (opts: Record<string, unknown>) => navigations.push(opts),
}))

import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import '../rtl-settle'

import { useQueryState, useQueryArrayState } from '../../src/hooks/use-query-state'

function setURL(url: string) {
  const happy = (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM
  happy?.setURL(url)
}

function TwoSetterProbe() {
  const [, setView] = useQueryState('view', 'kanban')
  const [, setTags] = useQueryArrayState('tags')
  const [, , pushTaskId] = useQueryState('taskId', '')
  return (
    <>
      <button type="button" onClick={() => { setView('table'); setTags(['a', 'b']) }}>both</button>
      <button type="button" onClick={() => { setView('table'); pushTaskId('t1') }}>mixed</button>
      <button type="button" onClick={() => setView('table')}>single</button>
      <button type="button" onClick={() => setView('kanban')}>reset</button>
    </>
  )
}

afterEach(() => {
  navigations.length = 0
  cleanup()
})

describe('useQueryState batching', () => {
  it('two setters in one tick land in ONE navigation with both params', async () => {
    setURL('http://localhost:3737/tasks')
    render(<TwoSetterProbe />)
    fireEvent.click(screen.getByRole('button', { name: 'both' }))
    await waitFor(() => expect(navigations.length).toBe(1))
    const nav = navigations[0]
    expect(nav.search).toEqual({ view: 'table', tags: 'a,b' })
    expect(nav.replace).toBe(true)
  })

  it('push wins over replace when any update in the tick pushed', async () => {
    setURL('http://localhost:3737/tasks')
    render(<TwoSetterProbe />)
    fireEvent.click(screen.getByRole('button', { name: 'mixed' }))
    await waitFor(() => expect(navigations.length).toBe(1))
    const nav = navigations[0]
    expect(nav.search).toEqual({ view: 'table', taskId: 't1' })
    expect(nav.replace).toBeUndefined()
  })

  it('single setter still navigates once, preserving unrelated params', async () => {
    setURL('http://localhost:3737/tasks?agent=main')
    render(<TwoSetterProbe />)
    fireEvent.click(screen.getByRole('button', { name: 'single' }))
    await waitFor(() => expect(navigations.length).toBe(1))
    expect(navigations[0].search).toEqual({ agent: 'main', view: 'table' })
  })

  it('default values remove the param from the URL', async () => {
    setURL('http://localhost:3737/tasks?view=table')
    render(<TwoSetterProbe />)
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    await waitFor(() => expect(navigations.length).toBe(1))
    expect(navigations[0].search).toEqual({})
  })

  it('two separate ticks produce two navigations (batching is per-tick)', async () => {
    setURL('http://localhost:3737/tasks')
    render(<TwoSetterProbe />)
    fireEvent.click(screen.getByRole('button', { name: 'single' }))
    await waitFor(() => expect(navigations.length).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))
    await waitFor(() => expect(navigations.length).toBe(2))
  })
})
