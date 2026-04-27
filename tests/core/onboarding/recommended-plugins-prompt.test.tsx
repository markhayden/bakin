/**
 * Tests for the Ink-based recommended-plugins prompt component
 * (Phase 6). Uses ink-testing-library to render the component
 * headlessly and simulate keystrokes.
 *
 * The component contract:
 *   - Initial selection seeds from each plugin's defaultSelected.
 *   - Arrow keys + j/k navigate the cursor.
 *   - Space toggles the cursor's plugin.
 *   - 'a' toggles all (selects every if any are unselected; otherwise
 *     deselects every).
 *   - Enter calls onSubmit with the selected ids in plugins-array order.
 *   - Escape / 'q' calls onSubmit with [].
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-onboard-prompt-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import React from 'react'
import { render } from 'ink-testing-library'
import { __PluginsPromptForTest as PluginsPrompt } from '../../../src/core/onboarding/recommended-plugins-prompt'
import type { RecommendedPlugin } from '../../../src/core/onboarding/types'

const FIXTURE: readonly RecommendedPlugin[] = [
  {
    id: 'messaging',
    source: 'github:madeinwyo/bakin-bits-official#plugins/messaging',
    name: 'Messaging',
    description: 'Brainstorm + draft + schedule content.',
    defaultSelected: true,
  },
  {
    id: 'projects',
    source: 'github:madeinwyo/bakin-bits-official#plugins/projects',
    name: 'Projects',
    description: 'Lightweight project tracker.',
    defaultSelected: false,
  },
  {
    id: 'extra',
    source: 'github:madeinwyo/bakin-bits-official#plugins/extra',
    name: 'Extra',
    description: 'A third recommendation.',
    defaultSelected: true,
  },
]

const ARROW_DOWN = '\x1b[B'
const ARROW_UP = '\x1b[A'
const ESC = '\x1b'
const ENTER = '\r'

// Ink's useInput is processed asynchronously through React state — the
// keystroke lands in stdin, useInput's effect handler runs, setState
// schedules a re-render, the next frame reflects the new state. Tests
// must await a microtask flush before the assertion can see the result.
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10))
}

describe('recommended-plugins prompt', () => {
  it('renders the plugin list with default selections marked', () => {
    let submitted: string[] | null = null
    const { lastFrame } = render(
      <PluginsPrompt plugins={FIXTURE} onSubmit={(ids) => { submitted = ids }} />,
    )
    const out = lastFrame()
    expect(out).toContain('Messaging')
    expect(out).toContain('Projects')
    expect(out).toContain('Extra')
    // Defaults: messaging + extra checked, projects unchecked.
    expect(out).toMatch(/\[x\] Messaging/)
    expect(out).toMatch(/\[ \] Projects/)
    expect(out).toMatch(/\[x\] Extra/)
    expect(submitted as string[] | null).toBeNull()
  })

  it('Enter submits with the default selection on no input', async () => {
    let submitted: string[] | null = null
    const { stdin } = render(
      <PluginsPrompt plugins={FIXTURE} onSubmit={(ids) => { submitted = ids }} />,
    )
    stdin.write(ENTER)
    await flush()
    expect(submitted as string[] | null).toEqual(['messaging', 'extra'])
  })

  it('Space toggles the cursor row', async () => {
    let submitted: string[] | null = null
    const { stdin } = render(
      <PluginsPrompt plugins={FIXTURE} onSubmit={(ids) => { submitted = ids }} />,
    )
    // Cursor starts on messaging (idx 0). Space deselects.
    stdin.write(' ')
    await flush()
    stdin.write(ENTER)
    await flush()
    expect(submitted as string[] | null).toEqual(['extra'])
  })

  it('Arrow down + space toggles a different row', async () => {
    let submitted: string[] | null = null
    const { stdin } = render(
      <PluginsPrompt plugins={FIXTURE} onSubmit={(ids) => { submitted = ids }} />,
    )
    stdin.write(ARROW_DOWN) // cursor → projects
    await flush()
    stdin.write(' ')        // select projects
    await flush()
    stdin.write(ENTER)
    await flush()
    expect(submitted as string[] | null).toEqual(['messaging', 'projects', 'extra'])
  })

  it('Arrow up wraps to the last item', async () => {
    let submitted: string[] | null = null
    const { stdin } = render(
      <PluginsPrompt plugins={FIXTURE} onSubmit={(ids) => { submitted = ids }} />,
    )
    stdin.write(ARROW_UP)   // cursor wraps from idx 0 → idx 2 (extra)
    await flush()
    stdin.write(' ')        // toggle extra OFF
    await flush()
    stdin.write(ENTER)
    await flush()
    expect(submitted as string[] | null).toEqual(['messaging'])
  })

  it("'a' selects all when some are unchecked", async () => {
    let submitted: string[] | null = null
    const { stdin } = render(
      <PluginsPrompt plugins={FIXTURE} onSubmit={(ids) => { submitted = ids }} />,
    )
    stdin.write('a')        // projects was the only unchecked → now all selected
    await flush()
    stdin.write(ENTER)
    await flush()
    expect(submitted as string[] | null).toEqual(['messaging', 'projects', 'extra'])
  })

  it("'a' deselects all when everything is checked", async () => {
    let submitted: string[] | null = null
    const { stdin } = render(
      <PluginsPrompt plugins={FIXTURE} onSubmit={(ids) => { submitted = ids }} />,
    )
    stdin.write('a') // selects all
    await flush()
    stdin.write('a') // deselects all
    await flush()
    stdin.write(ENTER)
    await flush()
    expect(submitted as string[] | null).toEqual([])
  })

  it('Escape submits with empty selection (cancel)', async () => {
    let submitted: string[] | null = null
    const { stdin } = render(
      <PluginsPrompt plugins={FIXTURE} onSubmit={(ids) => { submitted = ids }} />,
    )
    stdin.write(ESC)
    // Ink's terminal-input parser delays standalone escape briefly to
    // disambiguate from arrow-key sequences (\x1b[A etc). Wait long
    // enough for the escape to fire on its own.
    await new Promise((r) => setTimeout(r, 60))
    expect(submitted as string[] | null).toEqual([])
  })

  it("'q' submits with empty selection (cancel)", async () => {
    let submitted: string[] | null = null
    const { stdin } = render(
      <PluginsPrompt plugins={FIXTURE} onSubmit={(ids) => { submitted = ids }} />,
    )
    stdin.write('q')
    await flush()
    expect(submitted as string[] | null).toEqual([])
  })
})
