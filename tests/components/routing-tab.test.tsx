/**
 * Routing tab matrix — dispatch + system sections from WORK_CLASSES, thinking
 * dropdowns filtered to the active runtime's declared support, chat excluded.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import React from 'react'

const testDir = join(tmpdir(), 'bakin-test-routing-tab')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { RoutingTab } from '../../plugins/models/components/routing-tab'
import type { ModelsData } from '../../plugins/models/components/use-models-data'

function makeM(over: Partial<ModelsData> = {}): ModelsData {
  return {
    pendingRouting: null,
    setPendingRouting: () => {},
    saveRouting: async () => {},
    saving: null,
    displayRouting: { routes: [{ workClass: 'auto-title', model: 'anthropic/claude-haiku-4-5', thinking: 'off' }], tagOverrides: [] },
    routingSupport: {
      defaultModel: true, fallbackModels: false, defaultSubagentModel: false, aliases: false,
      perAgentSubagentModel: false, supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    },
    setRouteField: () => {},
    addTagOverride: () => {},
    updateTagOverride: () => {},
    removeTagOverride: () => {},
    modelOptions: [{ id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5' }],
    ...over,
  } as unknown as ModelsData
}

afterEach(cleanup)

// The thinking selects used to take their accessible name from a visible
// FieldLabel ("Scheduled Thinking"); the model selects took theirs from
// aria-label ("Scheduled model"). The routing matrix is a DataTable now, so the
// column header carries the field name once and BOTH controls are named
// uniformly by aria-label.
describe('RoutingTab', () => {
  it('renders dispatch + system sections; chat is excluded', () => {
    render(<RoutingTab m={makeM()} />)
    // Dispatch classes
    expect(screen.getByRole('heading', { name: 'Scheduled' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recovery' })).toBeTruthy()
    // System classes
    expect(screen.getByRole('heading', { name: 'Auto-title' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Relay' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Team routing' })).toBeTruthy()
    // Chat is metered-only — no matrix row.
    expect(screen.queryByRole('heading', { name: 'Chat' })).toBeNull()
  })

  it('thinking dropdowns offer only runtime-supported levels (Pi hides adaptive/max)', async () => {
    const user = userEvent.setup()
    render(<RoutingTab m={makeM()} />)
    await user.click(screen.getByRole('combobox', { name: 'Scheduled thinking' }))
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('Extra high')
    expect(options).not.toContain('Adaptive')
    expect(options).not.toContain('Maximum')
  })

  it('a persisted-but-unsupported level surfaces as a clamping option, never hidden', async () => {
    const user = userEvent.setup()
    render(<RoutingTab m={makeM({
      displayRouting: { routes: [{ workClass: 'relay', thinking: 'max' }], tagOverrides: [] },
    } as Partial<ModelsData>)} />)
    await user.click(screen.getByRole('combobox', { name: 'Relay thinking' }))
    expect(screen.getByRole('option', { name: 'Maximum · unsupported by this runtime' })).toBeTruthy()
  })
})
