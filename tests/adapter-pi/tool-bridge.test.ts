/**
 * Exec-tool descriptor filtering (P5.3 regression).
 *
 * The agent registry `allowlist` is the SUBAGENT dispatch allowlist (agent
 * ids, written by `agents.updateAllowlist` — installer/team add every new
 * package agent to main's list). It must never reach the exec-tool filter:
 * filtering tool names against agent ids stripped every bakin_exec_* tool
 * from main's live sessions the moment an agent package was installed.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { filterExecToolDescriptors } from '../../packages/adapter-pi/src/tool-bridge'
import type { RuntimeExecToolDescriptor } from '../../packages/core/src/adapters/runtime'

const DESCRIPTORS: RuntimeExecToolDescriptor[] = [
  { name: 'bakin_exec_tasks_get', description: 'get', parametersSchema: { type: 'object' } },
  { name: 'bakin_exec_tasks_complete', description: 'complete', parametersSchema: { type: 'object' } },
  { name: 'bakin_exec_assets_save', description: 'save', parametersSchema: { type: 'object' } },
]

describe('filterExecToolDescriptors', () => {
  test('default policy exposes every exec tool', () => {
    expect(filterExecToolDescriptors(DESCRIPTORS, {})).toEqual(DESCRIPTORS)
  })

  test("toolsMode 'none' removes all exec tools", () => {
    expect(filterExecToolDescriptors(DESCRIPTORS, { toolsMode: 'none' })).toEqual([])
  })

  test('toolsAllow narrows, toolsDeny subtracts', () => {
    expect(
      filterExecToolDescriptors(DESCRIPTORS, { toolsAllow: ['bakin_exec_tasks_get', 'bakin_exec_assets_save'] }).map((d) => d.name),
    ).toEqual(['bakin_exec_tasks_get', 'bakin_exec_assets_save'])
    expect(
      filterExecToolDescriptors(DESCRIPTORS, { toolsDeny: ['bakin_exec_assets_save'] }).map((d) => d.name),
    ).toEqual(['bakin_exec_tasks_get', 'bakin_exec_tasks_complete'])
  })

  test('REGRESSION: session build must not feed the dispatch allowlist into the tool filter', () => {
    // Signature no longer accepts an allowlist; pin the call site so the
    // conflation cannot be reintroduced without failing here.
    const messaging = readFileSync(
      join(import.meta.dir, '../../packages/adapter-pi/src/messaging.ts'),
      'utf-8',
    )
    const callSites = messaging.match(/filterExecToolDescriptors\([^)]*\)/g) ?? []
    expect(callSites.length).toBeGreaterThan(0)
    for (const call of callSites) {
      expect(call).not.toContain('allowlist')
    }
  })
})
