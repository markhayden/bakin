// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Pure client component, but pin the resolvers per the repo-wide
// test-isolation rules so nothing transitive can reach ~/.bakin.
const isolationDir = join(tmpdir(), `bakin-test-plugin-header-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => isolationDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => isolationDir,
}))

let warmState: 'cold' | 'warming' | 'warm' = 'warm'

mock.module('@/hooks/use-search-warm', () => ({
  useSearchWarm: mock(() => warmState),
}))

import { PluginHeader } from '../../src/components/plugin-header'

afterEach(() => {
  cleanup()
  warmState = 'warm'
  mock.clearAllMocks()
})

describe('PluginHeader search + warm indicator', () => {
  it('debounces keystrokes into onChange', async () => {
    const onChange = mock()
    render(
      <PluginHeader
        title="Assets"
        search={{ value: '', onChange, placeholder: 'Search assets...', debounce: 10 }}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'diagram' } })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('diagram'))
  })

  it('NEVER blocks input while warming — the indicator is display-only', async () => {
    // Regression guard: an earlier iteration held keystrokes until the warm
    // signal flipped, which froze every search bar (including client-side
    // filters) whenever boot warm-up or background indexing ran long. The
    // warming state must only change the icon/tooltip.
    warmState = 'warming'
    const onChange = mock()
    render(
      <PluginHeader
        title="Assets"
        search={{ value: '', onChange, placeholder: 'Search assets...', debounce: 10 }}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'diagram' } })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('diagram'))
  })
})
