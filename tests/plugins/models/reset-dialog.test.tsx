// @vitest-environment jsdom
/**
 * ResetToPlan's snapshot lifecycle (S6, review round 4/5): the handle the
 * FIRST attempt returns is the undo point for every retry of that reset,
 * a new reset (after a success or after the dialog was closed) mints its
 * own snapshot, and a partial reset closed without completing keeps its
 * handle visible on the page.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'
import '../../rtl-settle'

const testDir = join(tmpdir(), `bakin-test-reset-dialog-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { ResetToPlan } from '../../../plugins/models/components/reset-dialog'
import type { SaveOutcome, SelectionsData } from '../../../plugins/models/components/use-selections'

const LUNA = 'openai-codex/gpt-5.6-luna'
const MINI = 'openai-codex/gpt-5.4-mini'

let submits: Array<{ refs: string[]; snapshot?: 'reset' }> = []
let outcomes: SaveOutcome[] = []

function fakeSel(): SelectionsData {
  const states = [
    { ref: 'policy:defaultModel', model: LUNA, document: 'policy', label: 'Default model' },
    { ref: 'policy:defaultSubagentModel', model: MINI, document: 'policy', label: 'Default subagent model' },
  ]
  return {
    selections: {
      revision: 'rev-1',
      support: { defaultModel: true, fallbackModels: true, defaultSubagentModel: true, aliases: true, perAgentSubagentModel: true, supportedThinkingLevels: ['off', 'low'], perTurnModel: true },
      states,
      proposals: [],
      pending: [],
      evidence: { catalog: 'ok', runtimeAvailability: 'ok', credentials: 'ok', rejections: 'ok' },
    },
    customizations: [{ ref: 'policy:defaultSubagentModel', label: 'Default subagent model', value: MINI }] as never,
    effective: (ref: string) => ({ model: states.find((s) => s.ref === ref)?.model ?? null, thinking: null, staged: false }),
    dirty: false,
    submit: mock(async (ops: Array<{ ref: string }>, extra?: { snapshot?: 'reset' }) => {
      submits.push({ refs: ops.map((op) => op.ref), ...(extra?.snapshot ? { snapshot: extra.snapshot } : {}) })
      return outcomes.shift() ?? { applied: ops.map((op) => op.ref), failed: [], pending: [], warnings: [] }
    }),
    reload: mock(async () => {}),
  } as unknown as SelectionsData
}

const click = (el: HTMLElement) => act(async () => { fireEvent.click(el) })
const type = (el: HTMLElement, value: string) => act(async () => { fireEvent.change(el, { target: { value } }) })

/** Type the confirmation and press Reset inside an already-open dialog. */
async function pressReset(dialog: HTMLElement) {
  await type(within(dialog).getByPlaceholderText('reset'), 'reset')
  await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(false))
  await click(within(dialog).getByRole('button', { name: 'Reset' }))
}

async function confirmReset() {
  await click(await screen.findByRole('button', { name: 'Reset to this plan…' }))
  const dialog = await screen.findByRole('dialog')
  await pressReset(dialog)
  return dialog
}

beforeEach(() => {
  submits = []
  outcomes = []
})
afterEach(() => cleanup())

describe('ResetToPlan snapshot lifecycle', () => {
  it('a NEW reset after a successful one mints its own snapshot and advertises THAT handle (review P2)', async () => {
    outcomes = [
      { applied: ['policy:defaultSubagentModel'], failed: [], pending: [], warnings: [], snapshot: '/snapshots/first.json' },
      { applied: ['policy:defaultSubagentModel'], failed: [], pending: [], warnings: [], snapshot: '/snapshots/second.json' },
    ]
    render(<ResetToPlan sel={fakeSel()} />)
    await confirmReset()
    expect((await screen.findByRole('status')).textContent).toContain('bakin models restore /snapshots/first.json')
    // The fake keeps its customization, so the operator can reset again without remounting.
    await confirmReset()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('bakin models restore /snapshots/second.json'))
    expect(submits.map((s) => s.snapshot)).toEqual(['reset', 'reset'])
  })

  it('a retry of a PARTIAL reset reuses the first handle and requests no new snapshot; closing the dialog ends the operation', async () => {
    outcomes = [
      { applied: [], failed: [{ ref: 'policy:defaultSubagentModel', message: 'adapter exploded' }], pending: [], warnings: [], snapshot: '/snapshots/first.json' },
      { applied: [], failed: [{ ref: 'policy:defaultSubagentModel', message: 'still exploding' }], pending: [], warnings: [] },
      { applied: ['policy:defaultSubagentModel'], failed: [], pending: [], warnings: [], snapshot: '/snapshots/third.json' },
    ]
    render(<ResetToPlan sel={fakeSel()} />)
    let dialog = await confirmReset()
    await within(dialog).findByText(/adapter exploded/)
    expect(within(dialog).getByText(/bakin models restore \/snapshots\/first\.json/)).toBeTruthy()
    // Retry inside the same dialog: no snapshot requested, same handle named.
    await pressReset(dialog)
    await within(dialog).findByText(/still exploding/)
    expect(within(dialog).getByText(/bakin models restore \/snapshots\/first\.json/)).toBeTruthy()
    expect(submits.map((s) => s.snapshot)).toEqual(['reset', undefined])
    // Give up: the page keeps the partial reset's handle in view…
    await click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('partially applied'))
    expect(screen.getByRole('status').textContent).toContain('bakin models restore /snapshots/first.json')
    // …and the next reset is a new operation with its own snapshot.
    dialog = await confirmReset()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('/snapshots/third.json'))
    expect(submits.map((s) => s.snapshot)).toEqual(['reset', undefined, 'reset'])
  })
})
