/**
 * Routing tab matrix — dispatch + system sections from WORK_CLASSES, thinking
 * dropdowns filtered to the active runtime's declared support, chat excluded.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
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

describe('RoutingTab', () => {
  it('renders dispatch + system sections; chat is excluded', () => {
    render(<RoutingTab m={makeM()} />)
    // Dispatch classes
    expect(screen.getByText('Scheduled')).toBeTruthy()
    expect(screen.getByText('Recovery')).toBeTruthy()
    // System classes
    expect(screen.getByText('Auto-title')).toBeTruthy()
    expect(screen.getByText('Relay')).toBeTruthy()
    expect(screen.getByText('Team routing')).toBeTruthy()
    // Chat is metered-only — no matrix row.
    expect(screen.queryByText('Chat')).toBeNull()
  })

  it('thinking dropdowns offer only runtime-supported levels (Pi hides adaptive/max)', () => {
    render(<RoutingTab m={makeM()} />)
    const options = Array.from(document.querySelectorAll('select option')).map((o) => (o as HTMLOptionElement).value)
    expect(options).toContain('xhigh')
    expect(options).not.toContain('adaptive')
    expect(options).not.toContain('max')
  })

  it('a persisted-but-unsupported level surfaces as a clamping option, never hidden', () => {
    render(<RoutingTab m={makeM({
      displayRouting: { routes: [{ workClass: 'relay', thinking: 'max' }], tagOverrides: [] },
    } as Partial<ModelsData>)} />)
    expect(screen.getByText('max (clamps — not supported by this runtime)')).toBeTruthy()
  })
})
