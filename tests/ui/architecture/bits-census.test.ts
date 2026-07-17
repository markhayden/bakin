import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  buildCompatibilityMatrix,
  scanOfficialCensus,
  toCoreOnlyCensus,
  validateCensus,
  validateCompatibilityMatrix,
} from '../../../scripts/ui/census'

const fixtureRoots: string[] = []

function writeFixture(root: string, path: string, source: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source)
}

function manifest(
  id: string,
  routes: string[],
  slots: string[] = [],
  version = '1.0.0',
): string {
  return JSON.stringify({
    id,
    name: id,
    version,
    bakin: '>=0.0.1-rc.1',
    contributes: {
      routes: routes.map((path) => ({ path })),
      slots,
    },
  })
}

function createFixture(): { bakinRoot: string; bitsRoot: string; bitsPluginsRoot: string } {
  const parent = mkdtempSync(join(tmpdir(), 'bakin-bits-census-test-'))
  fixtureRoots.push(parent)
  const bakinRoot = join(parent, 'bakin')
  const bitsRoot = join(parent, 'bakin-bits-official')
  const bitsPluginsRoot = join(bitsRoot, 'plugins')
  writeFixture(bakinRoot, 'packages/sdk/package.json', JSON.stringify({ version: '0.0.0-workspace' }))
  writeFixture(bitsRoot, 'test-sdk/package.json', JSON.stringify({ version: '0.0.1-rc.1' }))

  writeFixture(bitsRoot, 'plugins/messaging/bakin-plugin.json', manifest('messaging', [
    '/messaging',
    '/messaging/calendar',
    '/messaging/plans',
    '/messaging/plans/[id]',
    '/messaging/brainstorm',
  ], ['nav-badge-providers'], '0.8.0'))
  writeFixture(bitsRoot, 'plugins/messaging/client.tsx', [
    "import { registerPlugin } from '@makinbakin/sdk'",
    "function MessagingIndexRoute() { router.replace('/messaging/calendar'); return null }",
    'function CalendarRoute() { return <main /> }',
    'function PlansRoute() { return <main /> }',
    'function PlanRoute() { return <main /> }',
    'function BrainstormRoute() { return <main /> }',
    'function PlansBadgeProvider() { return null }',
    "registerPlugin({ id: 'messaging', routes: {",
    "  '/messaging': MessagingIndexRoute,",
    "  '/messaging/calendar': CalendarRoute,",
    "  '/messaging/plans': PlansRoute,",
    "  '/messaging/plans/[id]': PlanRoute,",
    "  '/messaging/brainstorm': BrainstormRoute,",
    "}, slots: { 'nav-badge-providers': PlansBadgeProvider } })",
  ].join('\n'))

  writeFixture(bitsRoot, 'plugins/projects/bakin-plugin.json', manifest('projects', [
    '/projects',
    '/projects/new',
    '/projects/[id]',
    '/projects/[id]/edit',
  ], [], '0.7.0'))
  writeFixture(bitsRoot, 'plugins/projects/client.tsx', [
    "import { registerPlugin } from '@makinbakin/sdk'",
    'function ProjectsIndexRoute() { return <main /> }',
    "function ProjectsNewRoute() { router.replace('/projects'); return null }",
    'function ProjectDetailRoute() { return <main /> }',
    'function ProjectEditRoute() { return <main /> }',
    "registerPlugin({ id: 'projects', routes: {",
    "  '/projects': ProjectsIndexRoute, '/projects/new': ProjectsNewRoute,",
    "  '/projects/[id]': ProjectDetailRoute, '/projects/[id]/edit': ProjectEditRoute,",
    '} })',
  ].join('\n'))

  writeFixture(bitsRoot, 'plugins/_template/bakin-plugin.json', manifest('_template', [], ['page:/_template']))
  writeFixture(bitsRoot, 'plugins/_template/client.tsx', [
    "import { registerPlugin } from '@makinbakin/sdk'",
    'function TemplatePage() { return <main /> }',
    "registerPlugin({ id: '_template', slots: { 'page:/_template': TemplatePage } })",
  ].join('\n'))
  return { bakinRoot, bitsRoot, bitsPluginsRoot }
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('official Bits census', () => {
  it('includes Messaging, Projects, their badge/page slots, and the author template', () => {
    const { bakinRoot, bitsPluginsRoot } = createFixture()
    const census = scanOfficialCensus(bakinRoot, bitsPluginsRoot)
    const bitsEntries = census.entries.filter((entry) => entry.owner.repository === 'bakin-bits-official')

    expect(census.scope.repositories).toEqual(['bakin', 'bakin-bits-official'])
    expect(bitsEntries.filter((entry) => entry.kind === 'plugin-route')).toHaveLength(9)
    expect(bitsEntries.filter((entry) => entry.kind === 'plugin-route' && entry.owner.pluginId === 'messaging' && entry.classification === 'visual-surface')).toHaveLength(4)
    expect(bitsEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'plugin-route:messaging:/messaging',
        classification: 'non-visual-alias',
        symbols: ['MessagingIndexRoute'],
      }),
      expect.objectContaining({
        id: 'plugin-route:projects:/projects/[id]/edit',
        symbols: ['ProjectEditRoute'],
      }),
      expect.objectContaining({
        id: 'plugin-slot:messaging:nav-badge-providers',
        symbols: ['PlansBadgeProvider'],
      }),
      expect.objectContaining({
        id: 'plugin-slot:_template:page:/_template',
        symbols: ['TemplatePage'],
      }),
      expect.objectContaining({
        id: 'plugin-template:_template',
        kind: 'plugin-template',
      }),
    ]))
    expect(validateCensus(census)).toEqual([])
  })

  it('surfaces a seeded Bits route missing from the client registration', () => {
    const { bakinRoot, bitsRoot, bitsPluginsRoot } = createFixture()
    writeFixture(bitsRoot, 'plugins/messaging/bakin-plugin.json', manifest('messaging', [
      '/messaging',
      '/messaging/calendar',
      '/messaging/plans',
      '/messaging/plans/[id]',
      '/messaging/brainstorm',
      '/messaging/missing',
    ], ['nav-badge-providers']))

    expect(validateCensus(scanOfficialCensus(bakinRoot, bitsPluginsRoot))).toContain(
      'plugin-route:messaging:/messaging/missing is missing its client route registration',
    )
  })

  it('fails full mode clearly when official Bits input is unavailable', () => {
    const { bakinRoot, bitsRoot } = createFixture()
    expect(() => scanOfficialCensus(bakinRoot, join(bitsRoot, 'missing'))).toThrow(
      'Official Bits plugins input is unavailable',
    )
  })

  it('keeps core-only mode explicitly labeled as partial', () => {
    const { bakinRoot, bitsPluginsRoot } = createFixture()
    const partial = toCoreOnlyCensus(scanOfficialCensus(bakinRoot, bitsPluginsRoot))
    expect(partial.scope).toMatchObject({ mode: 'partial-core-only', repositories: ['bakin'] })
    expect(partial.entries.every((entry) => entry.owner.repository === 'bakin')).toBe(true)
  })
})

describe('official compatibility matrix', () => {
  it('records exact refs, SDK versions, plugin ranges, and both first-party repositories', () => {
    const { bakinRoot, bitsPluginsRoot } = createFixture()
    const matrix = buildCompatibilityMatrix(bakinRoot, bitsPluginsRoot, {
      bakinRef: 'a'.repeat(40),
      bitsRef: 'b'.repeat(40),
    })

    expect(matrix.firstPartyScope).toEqual(['core', 'official-bits'])
    expect(matrix.repositories).toEqual({
      bakin: { ref: 'a'.repeat(40) },
      'bakin-bits-official': { ref: 'b'.repeat(40) },
    })
    expect(matrix.sdk).toEqual({
      workspaceVersion: '0.0.0-workspace',
      officialBitsFixtureVersion: '0.0.1-rc.1',
    })
    expect(matrix.plugins.messaging).toMatchObject({
      repository: 'bakin-bits-official',
      version: '0.8.0',
      bakinRange: '>=0.0.1-rc.1',
      routes: { total: 5, visual: 4, aliases: ['/messaging'] },
    })
    expect(validateCompatibilityMatrix(matrix)).toEqual([])
  })
})
