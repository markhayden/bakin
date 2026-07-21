import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  diffCensusEntries,
  scanCoreCensus,
  validateCensus,
} from '../../../scripts/ui/census'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const fixtureRoots: string[] = []

function writeFixture(root: string, path: string, source: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source)
}

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-ui-census-test-'))
  fixtureRoots.push(root)
  writeFixture(root, 'packages/host/src/routes/tasks.tsx', [
    "import { createRoute } from '@tanstack/react-router'",
    "const unrelated = { path: '/not-the-route' }",
    "export const Route = createRoute({ path: '/tasks' })",
  ].join('\n'))
  writeFixture(root, 'plugins/tasks/bakin-plugin.json', JSON.stringify({
    id: 'tasks',
    contributes: { slots: ['page:/tasks', 'nav-badge-providers'] },
  }))
  writeFixture(root, 'plugins/tasks/client.tsx', [
    "import { registerPlugin } from '@makinbakin/sdk'",
    'function TasksPage() { return <main /> }',
    'function TasksBadge() { return null }',
    "registerPlugin({ id: 'tasks', slots: { 'page:/tasks': TasksPage, 'nav-badge-providers': TasksBadge } })",
  ].join('\n'))
  writeFixture(root, 'src/components/button.tsx', [
    'export interface ButtonProps { label: string }',
    'export function Button({ label }: ButtonProps) { return <button>{label}</button> }',
  ].join('\n'))
  writeFixture(
    root,
    'packages/sdk/src/components/index.ts',
    "export { Button } from '@/components/button'\nexport type { ButtonProps } from '@/components/button'\n",
  )
  return root
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('scanCoreCensus', () => {
  it('discovers routes, manifest slots, shared components, and public SDK exports', () => {
    const census = scanCoreCensus(createFixture())

    expect(census.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'host-route:tasks',
        kind: 'host-route',
        identity: expect.objectContaining({ route: '/tasks' }),
        sourcePath: 'packages/host/src/routes/tasks.tsx',
      }),
      expect.objectContaining({
        id: 'plugin-slot:tasks:page:/tasks',
        kind: 'plugin-slot',
        identity: expect.objectContaining({ route: '/tasks', slot: 'page:/tasks' }),
        sourcePath: 'plugins/tasks/client.tsx',
        symbols: ['TasksPage'],
        evidence: [
          expect.objectContaining({ type: 'manifest-slot', path: 'plugins/tasks/bakin-plugin.json' }),
          expect.objectContaining({ type: 'client-registration', path: 'plugins/tasks/client.tsx' }),
        ],
      }),
      expect.objectContaining({
        id: 'shared-component:src/components/button',
        kind: 'shared-component',
        exportStatus: 'public',
        symbols: ['Button'],
      }),
      expect.objectContaining({
        id: 'sdk-ui-export:value:Button',
        kind: 'sdk-ui-export',
        identity: expect.objectContaining({
          entrypoint: '@makinbakin/sdk/components',
          symbol: 'Button',
        }),
        sourcePath: 'src/components/button.tsx',
      }),
      expect.objectContaining({
        id: 'sdk-ui-export:type:ButtonProps',
        kind: 'sdk-ui-export',
        exportStatus: 'public',
      }),
    ]))
    expect(validateCensus(census)).toEqual([])
  })

  it('classifies the root redirect as a non-visual alias', () => {
    const root = createFixture()
    writeFixture(root, 'packages/host/src/routes/index.tsx', [
      "import { createRoute, redirect } from '@tanstack/react-router'",
      "export const Route = createRoute({ path: '/', beforeLoad: () => { throw redirect({ to: '/tasks' }) } })",
    ].join('\n'))

    const entry = scanCoreCensus(root).entries.find((candidate) => candidate.id === 'host-route:index')
    expect(entry).toMatchObject({
      classification: 'non-visual-alias',
      identity: { route: '/' },
    })
  })

  it('rejects public barrel syntax that the census cannot expand safely', () => {
    const root = createFixture()
    writeFixture(root, 'packages/sdk/src/components/index.ts', "export * from '@/components/button'\n")

    expect(() => scanCoreCensus(root)).toThrow('Unsupported public SDK export syntax')
  })

  it('follows legacy component exports delegated to a focused SDK entrypoint', () => {
    const root = createFixture()
    writeFixture(root, 'packages/sdk/src/conversation/index.ts', [
      'export function foldConversation() { return [] }',
      'export interface ConversationTurn {}',
    ].join('\n'))
    writeFixture(root, 'packages/sdk/src/components/index.ts', [
      "export { foldConversation } from '@makinbakin/sdk/conversation'",
      "export type { ConversationTurn } from '@makinbakin/sdk/conversation'",
    ].join('\n'))

    const entries = scanCoreCensus(root).entries
    expect(entries).toContainEqual(expect.objectContaining({
      id: 'sdk-ui-export:value:foldConversation',
      sourcePath: 'packages/sdk/src/conversation/index.ts',
    }))
    expect(entries).toContainEqual(expect.objectContaining({
      id: 'sdk-ui-export:type:ConversationTurn',
      sourcePath: 'packages/sdk/src/conversation/index.ts',
    }))
  })

  it('surfaces a client slot that has no mirrored manifest declaration', () => {
    const root = createFixture()
    writeFixture(root, 'plugins/orphan/client.tsx', [
      "import { registerPlugin } from '@makinbakin/sdk'",
      'function OrphanPage() { return <main /> }',
      "registerPlugin({ id: 'orphan', slots: { 'page:/orphan': OrphanPage } })",
    ].join('\n'))

    const census = scanCoreCensus(root)
    expect(census.entries).toContainEqual(expect.objectContaining({
      id: 'plugin-slot:orphan:page:/orphan',
      symbols: ['OrphanPage'],
    }))
    expect(validateCensus(census)).toContain(
      'plugin-slot:orphan:page:/orphan is missing its manifest slot declaration',
    )
  })
})

describe('diffCensusEntries', () => {
  it('fails completeness when a route or shared component is newly unregistered', () => {
    const root = createFixture()
    const expected = scanCoreCensus(root)
    writeFixture(
      root,
      'packages/host/src/routes/settings.tsx',
      "export const Route = createRoute({ path: '/settings' })",
    )
    writeFixture(root, 'src/components/new-panel.tsx', 'export function NewPanel() { return <section /> }')

    expect(diffCensusEntries(expected, scanCoreCensus(root))).toEqual([
      'unregistered census entry: host-route:settings',
      'unregistered census entry: shared-component:src/components/new-panel',
    ])
  })
})

describe('the Bakin core census', () => {
  it('accounts for every current host route and core manifest slot', () => {
    const census = scanCoreCensus(REPO_ROOT)
    const byKind = (kind: string) => census.entries.filter((entry) => entry.kind === kind)

    expect(byKind('host-route')).toHaveLength(26)
    expect(byKind('plugin-slot')).toHaveLength(28)
    expect(byKind('plugin-template')).toContainEqual(expect.objectContaining({
      id: 'plugin-template:reference-plugin',
      owner: expect.objectContaining({ pluginId: 'reference-bookmarks' }),
    }))
    expect(byKind('shared-component').length).toBeGreaterThan(80)
    expect(byKind('sdk-ui-export').length).toBeGreaterThan(80)
    expect(validateCensus(census)).toEqual([])
  })
})
