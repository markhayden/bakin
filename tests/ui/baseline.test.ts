import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  REQUIRED_PAGE_ARCHETYPES,
  countStyleViolations,
  expandCapturePlan,
  findPortabilityViolations,
  selectFixtureMode,
  validateBaselineScenarios,
  type BaselineManifest,
  type BaselineScenario,
} from '../../scripts/ui/baseline'

const manifest = JSON.parse(readFileSync(
  resolve(import.meta.dir, '../../design-system/baseline/manifest.json'),
  'utf-8',
)) as BaselineManifest

function completeScenarios(): BaselineScenario[] {
  return REQUIRED_PAGE_ARCHETYPES.map((archetype, index) => ({
    id: archetype,
    archetype,
    owner: index === 0 ? 'bits' : 'core',
    route: index === 0 ? '/projects' : `/${archetype}`,
    ready: 'main',
    expectText: index === 0 ? 'Projects' : undefined,
    viewports: ['desktop', 'mobile'],
  }))
}

describe('validateBaselineScenarios', () => {
  it('accepts full desktop/mobile archetype coverage with an official Bits page', () => {
    expect(validateBaselineScenarios(completeScenarios())).toEqual([])
  })

  it('reports missing viewport coverage and missing Bits ownership', () => {
    const scenarios = completeScenarios().map((scenario) => ({
      ...scenario,
      owner: 'core' as const,
      viewports: scenario.archetype === 'inspector'
        ? (['desktop'] as const)
        : scenario.viewports,
    }))

    expect(validateBaselineScenarios(scenarios)).toEqual([
      'archetype "inspector" is missing mobile coverage',
      'at least one official Bits scenario is required',
    ])
  })

  it('rejects duplicate IDs and routes that are not root-relative', () => {
    const scenarios = completeScenarios()
    scenarios[1] = { ...scenarios[1], id: scenarios[0].id, route: 'https://example.com/detail' }

    expect(validateBaselineScenarios(scenarios)).toContain(`duplicate scenario id "${scenarios[0].id}"`)
    expect(validateBaselineScenarios(scenarios)).toContain(
      `scenario "${scenarios[0].id}" route must be a root-relative application path`,
    )
  })
})

describe('the checked-in baseline manifest', () => {
  it('expands to a unique desktop/mobile capture for every scenario', () => {
    expect(validateBaselineScenarios(manifest.scenarios)).toEqual([])

    const plan = expandCapturePlan(manifest)
    expect(plan).toHaveLength(16)
    expect(new Set(plan.map((target) => target.outputFile)).size).toBe(plan.length)
    expect(plan.filter((target) => target.owner === 'bits')).toHaveLength(2)
    expect(plan.map((target) => target.viewportId).sort()).toEqual([
      ...Array(8).fill('desktop'),
      ...Array(8).fill('mobile'),
    ])
  })
})

describe('selectFixtureMode', () => {
  it('starts a fresh fixture for the default capture URL', () => {
    expect(selectFixtureMode({ explicitBaseUrl: false, serverReady: false })).toBe('start')
  })

  it('only reuses a running fixture when the caller opted in explicitly', () => {
    expect(selectFixtureMode({ explicitBaseUrl: true, serverReady: true })).toBe('use-existing')
    expect(() => selectFixtureMode({ explicitBaseUrl: false, serverReady: true })).toThrow(
      'already has a healthy server',
    )
  })

  it('does not try to start the fixed fixture command for an unreachable custom URL', () => {
    expect(() => selectFixtureMode({ explicitBaseUrl: true, serverReady: false })).toThrow(
      'Explicit baseline server is not reachable',
    )
  })
})

describe('findPortabilityViolations', () => {
  it('accepts repository-relative commands, refs, and output locations', () => {
    const report = {
      refs: { bakin: 'abc123', bits: 'def456' },
      commands: ['bun run ui:baseline:capture'],
      outputLocations: ['design-system/baseline/current/screenshots'],
    }

    expect(findPortabilityViolations(report)).toEqual([])
  })

  it('finds machine-specific Unix and Windows paths anywhere in a report', () => {
    const report = {
      outputLocations: ['/Users/person/project/screenshots'],
      nested: { log: 'C:\\Users\\person\\capture.log' },
    }

    expect(findPortabilityViolations(report)).toEqual([
      'outputLocations[0] contains an absolute filesystem path',
      'nested.log contains an absolute filesystem path',
    ])
  })
})

describe('countStyleViolations', () => {
  it('counts preliminary style debt by rule and source path', () => {
    const result = countStyleViolations([
      {
        path: 'plugins/example/client.tsx',
        source: '<button className="bg-red-500 w-[37px]" style={{ color: "#fff" }}>Go</button>',
      },
      {
        path: 'packages/host/src/Page.tsx',
        source: '<input className="text-slate-400" />',
      },
    ])

    expect(result.totals).toEqual({
      'arbitrary-value': 1,
      'inline-style': 1,
      'native-control': 2,
      'raw-color': 3,
    })
    expect(result.byPath['plugins/example/client.tsx']['native-control']).toBe(1)
  })
})
