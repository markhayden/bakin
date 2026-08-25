import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  applyLegacyStyleExceptions,
  collectLegacyStyleSources,
  diffLegacyStyleReport,
  scanLegacyStyles,
  type LegacyStyleExceptionDocument,
  type LegacyStyleMigrations,
  type LegacyStyleSource,
} from '../../../scripts/ui/check-legacy-styles'

const fixtureRoots: string[] = []

function source(path: string, sourceText: string): LegacyStyleSource {
  return {
    path,
    repository: path.startsWith('bakin-bits-official/') ? 'bakin-bits-official' : 'bakin',
    source: sourceText,
  }
}

function writeFixture(root: string, path: string, sourceText: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, sourceText)
}

function migrations(
  path: string,
  allowances: LegacyStyleMigrations['entries'][number]['allowances'],
): LegacyStyleMigrations {
  const totals = Object.fromEntries(Object.entries(allowances))
  return {
    schemaVersion: 1,
    generatedBy: 'bun run ui:legacy-styles:generate',
    scope: {
      mode: 'official',
      repositories: ['bakin', 'bakin-bits-official'],
      compatibilityMatrix: 'design-system/compatibility.json',
    },
    rules: [
      'raw-palette',
      'arbitrary-size',
      'raw-control',
      'inline-style',
      'generic-token',
      'unscoped-css',
      'private-import',
    ],
    summary: { paths: 1, totals },
    entries: [{
      path,
      owner: { repository: 'bakin', area: 'plugin', pluginId: 'example' },
      censusEntryId: 'plugin-slot:example:page:/example',
      migrationTask: 'T42a',
      archetype: 'plugin-contract',
      target: 'supported SDK UI and namespaced semantic tokens',
      status: 'legacy-allowed',
      allowances,
    }],
  }
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('scanLegacyStyles', () => {
  it('finds every ratcheted legacy pattern in a seeded plugin offender', () => {
    const report = scanLegacyStyles([
      source('plugins/example/components/offender.tsx', [
        "import { Button } from '@/components/ui/button'",
        'export function Offender() {',
        // Arbitrary-variant (`group-data-[open]:`) and container-variant
        // (`@lg/page-shell:`) forms must be caught for EVERY rule — a prefix
        // regression used to slip past raw-palette/arbitrary-size/generic-token.
        '  return <button className="w-[37px] bg-red-500 text-foreground text-sm rounded-lg gap-2 @lg/page-shell:p-3 group-data-[open]:bg-red-500 group-data-[open]:w-[37px] group-data-[open]:text-foreground" style={{ color: \'#fff\' }}>Bad</button>',
        '}',
      ].join('\n')),
      source('plugins/example/client.css', '.card { color: var(--foreground); }'),
    ])

    expect(report.totals).toEqual({
      'raw-palette': 3,
      'arbitrary-size': 2,
      'raw-scale': 4,
      'raw-control': 1,
      'inline-style': 1,
      'generic-token': 3,
      'unscoped-css': 1,
      'private-import': 1,
    })
    const noAllowances = { ...migrations('ignored', {}), summary: { paths: 0, totals: {} }, entries: [] }
    const failures = diffLegacyStyleReport(noAllowances, report)
    for (const rule of noAllowances.rules) {
      expect(failures.some((failure) => failure.includes(` ${rule} (`))).toBe(true)
    }
  })

  it('accepts supported SDK imports, namespaced tokens, primitives, and scoped plugin CSS', () => {
    const report = scanLegacyStyles([
      source('plugins/example/components/supported.tsx', [
        "import { Button } from '@makinbakin/sdk/ui'",
        'export function Supported() {',
        '  return <Button className="bg-bakin-surface text-bakin-foreground">Good</Button>',
        '}',
      ].join('\n')),
      source(
        'plugins/example/client.css',
        '[data-bakin-plugin="example"] .card { color: var(--bakin-color-foreground); }',
      ),
    ])

    expect(report.totals).toEqual({
      'raw-palette': 0,
      'arbitrary-size': 0,
      'raw-scale': 0,
      'raw-control': 0,
      'inline-style': 0,
      'generic-token': 0,
      'unscoped-css': 0,
      'private-import': 0,
    })
    expect(report.byPath).toEqual({})
  })
})

describe('diffLegacyStyleReport', () => {
  it('allows unchanged debt but rejects a path increase and a new rule', () => {
    const expected = migrations('plugins/example/components/card.tsx', {
      'raw-palette': 2,
      'raw-control': 1,
    })

    expect(diffLegacyStyleReport(expected, {
      totals: { 'raw-palette': 2, 'raw-control': 1 },
      byPath: {
        'plugins/example/components/card.tsx': { 'raw-palette': 2, 'raw-control': 1 },
      },
    })).toEqual([])

    expect(diffLegacyStyleReport(expected, {
      totals: { 'raw-palette': 3, 'raw-control': 2, 'inline-style': 1 },
      byPath: {
        'plugins/example/components/card.tsx': {
          'raw-palette': 3,
          'raw-control': 1,
          'inline-style': 1,
        },
        'plugins/example/components/new-card.tsx': { 'raw-control': 1 },
      },
    })).toEqual([
      'legacy style debt increased: plugins/example/components/card.tsx raw-palette 2 -> 3',
      'new legacy style debt: plugins/example/components/card.tsx inline-style (1)',
      'new legacy style debt: plugins/example/components/new-card.tsx raw-control (1)',
    ])
  })

  it('rejects a PAID-DOWN allowance so the ratchet tightens instead of holding', () => {
    // The ratchet used to accept reduced debt silently, which left every
    // completed migration sitting at its old ceiling — debt could creep all the
    // way back without CI noticing. Paying debt down now REQUIRES regenerating
    // the baseline, the same way a stale exception allowance already does.
    const expected = migrations('plugins/example/components/card.tsx', {
      'raw-palette': 2,
      'raw-control': 1,
    })

    expect(diffLegacyStyleReport(expected, {
      totals: { 'raw-palette': 1, 'raw-control': 1 },
      byPath: {
        'plugins/example/components/card.tsx': { 'raw-palette': 1, 'raw-control': 1 },
      },
    })).toEqual([
      'stale migration allowance: plugins/example/components/card.tsx raw-palette records 2 but only 1 remain; run bun run ui:legacy-styles:generate',
    ])
  })

  it('rejects an allowance whose file is now completely clean', () => {
    // The scanner reports nothing for a fully-migrated file, so the entry has
    // to disappear from the ledger rather than linger as free headroom.
    const expected = migrations('plugins/example/components/card.tsx', { 'raw-palette': 2 })

    expect(diffLegacyStyleReport(expected, { totals: {}, byPath: {} })).toEqual([
      'stale migration allowance: plugins/example/components/card.tsx raw-palette records 2 but only 0 remain; run bun run ui:legacy-styles:generate',
    ])
  })
})

describe('applyLegacyStyleExceptions', () => {
  const path = 'plugins/example/components/card.tsx'
  const exceptions = (
    allowances: Record<string, Record<string, number>> | undefined,
    scope = [path],
  ): LegacyStyleExceptionDocument => ({
    schemaVersion: 1,
    policy: 'Storybook is the default UI contract; deviations require approval.',
    exceptions: [{ id: 'example-exception', scope, allowances }],
  })

  it('subtracts exactly the recorded per-path counts and leaves the remainder as debt', () => {
    const { remaining, excepted, errors } = applyLegacyStyleExceptions(
      { totals: { 'raw-palette': 3, 'raw-control': 1 }, byPath: { [path]: { 'raw-palette': 3, 'raw-control': 1 } } },
      exceptions({ [path]: { 'raw-palette': 2 } }),
    )
    expect(errors).toEqual([])
    expect(excepted).toBe(2)
    expect(remaining.byPath).toEqual({ [path]: { 'raw-palette': 1, 'raw-control': 1 } })
    expect(remaining.totals['raw-palette']).toBe(1)
    expect(remaining.totals['raw-control']).toBe(1)
  })

  it('drops a fully covered path from the remaining report', () => {
    const { remaining, errors } = applyLegacyStyleExceptions(
      { totals: { 'inline-style': 1 }, byPath: { [path]: { 'inline-style': 1 } } },
      exceptions({ [path]: { 'inline-style': 1 } }),
    )
    expect(errors).toEqual([])
    expect(remaining.byPath).toEqual({})
  })

  it('fails on stale allowances instead of silently over-covering', () => {
    const { errors } = applyLegacyStyleExceptions(
      { totals: { 'raw-control': 1 }, byPath: { [path]: { 'raw-control': 1 } } },
      exceptions({ [path]: { 'raw-control': 2 } }),
    )
    expect(errors.some((error) => error.includes('stale exception allowance') && error.includes(path))).toBe(true)

    const orphaned = applyLegacyStyleExceptions(
      { totals: {}, byPath: {} },
      exceptions({ [path]: { 'raw-control': 1 } }),
    )
    expect(orphaned.errors.some((error) => error.includes('finds none'))).toBe(true)
  })

  it('rejects allowances outside the recorded scope and unknown rules', () => {
    const outside = applyLegacyStyleExceptions(
      { totals: {}, byPath: {} },
      exceptions({ 'plugins/other/components/x.tsx': { 'raw-control': 1 } }),
    )
    expect(outside.errors.some((error) => error.includes('outside its scope'))).toBe(true)

    const unknown = applyLegacyStyleExceptions(
      { totals: {}, byPath: {} },
      exceptions({ [path]: { 'not-a-rule': 1 } as Record<string, number> }),
    )
    expect(unknown.errors.some((error) => error.includes('unknown legacy-style rule'))).toBe(true)
  })
})

describe('collectLegacyStyleSources', () => {
  it('covers core, official Bits, and the reference plugin while excluding tests and server-only files', () => {
    const parent = mkdtempSync(join(tmpdir(), 'bakin-style-ratchet-test-'))
    fixtureRoots.push(parent)
    const bakinRoot = join(parent, 'bakin')
    const bitsPluginsRoot = join(parent, 'bakin-bits-official/plugins')
    writeFixture(bakinRoot, 'packages/host/src/routes/settings.tsx', 'export const Page = () => <main />')
    writeFixture(bakinRoot, 'packages/host/src/api/settings.ts', "const color = '#fff'")
    writeFixture(bakinRoot, 'plugins/tasks/components/card.tsx', 'export const Card = () => <main />')
    writeFixture(bakinRoot, 'plugins/tasks/tests/card.test.tsx', 'export const Test = () => <main />')
    writeFixture(bakinRoot, 'examples/reference-plugin/components/page.tsx', 'export const Page = () => <main />')
    writeFixture(bitsPluginsRoot, 'messaging/components/plan.tsx', 'export const Plan = () => <main />')

    expect(collectLegacyStyleSources(bakinRoot, bitsPluginsRoot).map((entry) => entry.path)).toEqual([
      'bakin-bits-official/plugins/messaging/components/plan.tsx',
      'examples/reference-plugin/components/page.tsx',
      'packages/host/src/routes/settings.tsx',
      'plugins/tasks/components/card.tsx',
    ])
  })

  it('fails clearly when official Bits input is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'bakin-style-ratchet-missing-bits-'))
    fixtureRoots.push(root)

    expect(() => collectLegacyStyleSources(root, join(root, 'missing'))).toThrow(
      'Official Bits plugins input is unavailable',
    )
  })
})
