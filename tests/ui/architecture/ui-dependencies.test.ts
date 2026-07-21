import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  diffUiPerformance,
  findDuplicateDesignSystemCss,
  findForbiddenBaseUiDependencies,
  findForbiddenFocusedSdkDependencies,
  measureReachableJsBytes,
  measureStableBuiltJsBytes,
  type UiPerformanceSnapshot,
} from '../../../scripts/ui/performance'

const fixtureRoots: string[] = []

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-ui-performance-test-'))
  fixtureRoots.push(root)
  return root
}

function writeFixture(root: string, path: string, source: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source)
}

function snapshot(overrides: Partial<UiPerformanceSnapshot> = {}): UiPerformanceSnapshot {
  return {
    schemaVersion: 1,
    generatedBy: 'bun run ui:performance:generate',
    scope: {
      mode: 'official',
      repositories: ['bakin', 'bakin-bits-official'],
      compatibilityMatrix: 'design-system/compatibility.json',
    },
    css: {
      canonicalPath: 'packages/sdk/styles.css',
      canonicalBytes: 100,
      copyCount: 1,
      copyPaths: ['packages/sdk/styles.css'],
    },
    hostInitialJs: { path: 'packages/host/dist/main.js', bytes: 200 },
    sdkUiBundles: [{
      name: 'sdk-ui',
      path: 'packages/host/public/vendor/sdk-ui.js',
      bytes: 50,
      reachableBytes: 80,
    }],
    vendorChunks: [{ path: 'packages/host/public/vendor/react.js', bytes: 70 }],
    pluginClients: [{
      repository: 'bakin',
      pluginId: 'tasks',
      path: 'plugins/tasks/dist/client.js',
      bytes: 90,
    }],
    ...overrides,
  }
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('base UI dependency direction', () => {
  it('rejects a transitive chart or conversation dependency but accepts base UI dependencies', () => {
    const root = fixtureRoot()
    writeFixture(root, 'packages/sdk/src/ui/index.ts', "export * from '@/components/ui/button'\n")
    writeFixture(root, 'src/components/ui/button.tsx', [
      "export * from '../charts/bar-chart'",
      "export type { ConversationTurn } from '../conversation/fold'",
    ].join('\n'))
    writeFixture(root, 'src/components/charts/bar-chart.tsx', 'export const BarChart = 1\n')
    writeFixture(root, 'src/components/conversation/fold.ts', 'export interface ConversationTurn {}\n')

    expect(findForbiddenBaseUiDependencies(root)).toEqual([
      'packages/sdk/src/ui/index.ts -> src/components/ui/button.tsx -> src/components/charts/bar-chart.tsx',
      'packages/sdk/src/ui/index.ts -> src/components/ui/button.tsx -> src/components/conversation/fold.ts',
    ])

    writeFixture(root, 'src/components/ui/button.tsx', "export * from './label'\n")
    writeFixture(root, 'src/components/ui/label.tsx', 'export const Label = 1\n')
    expect(findForbiddenBaseUiDependencies(root)).toEqual([])
  })

  it('keeps every base composition entrypoint out of chart and conversation domains', () => {
    const root = fixtureRoot()
    writeFixture(root, 'packages/sdk/src/ui/index.ts', 'export {}\n')
    writeFixture(root, 'packages/sdk/src/layout/index.ts', "export * from '@makinbakin/sdk/charts'\n")
    writeFixture(root, 'packages/sdk/src/patterns/index.ts', "export * from '../../../../src/components/conversation/fold'\n")
    writeFixture(root, 'packages/sdk/src/charts/index.ts', 'export const Chart = 1\n')
    writeFixture(root, 'packages/sdk/src/conversation/index.ts', 'export const Conversation = 1\n')
    writeFixture(root, 'src/components/conversation/fold.ts', 'export const fold = 1\n')

    expect(findForbiddenFocusedSdkDependencies(root)).toEqual([
      'packages/sdk/src/layout/index.ts -> packages/sdk/src/charts/index.ts',
      'packages/sdk/src/patterns/index.ts -> src/components/conversation/fold.ts',
    ])

    writeFixture(root, 'packages/sdk/src/patterns/index.ts', "export * from '@bakin/ui/conversation'\n")
    writeFixture(root, 'packages/ui/src/conversation/index.ts', 'export const fold = 1\n')
    expect(findForbiddenFocusedSdkDependencies(root)).toEqual([
      'packages/sdk/src/layout/index.ts -> packages/sdk/src/charts/index.ts',
      'packages/sdk/src/patterns/index.ts -> packages/ui/src/conversation/index.ts',
    ])
  })
})

describe('design-system stylesheet ownership', () => {
  it('rejects a plugin-bundled copy while accepting unrelated scoped CSS', () => {
    const canonical = {
      path: 'packages/sdk/styles.css',
      source: ':root { --bakin-color-surface: white; } .button { padding: 4px; }',
    }
    expect(findDuplicateDesignSystemCss(canonical, [
      canonical,
      {
        path: 'plugins/example/dist/client.css',
        source: '[data-bakin-plugin="example"] .card { display: grid; }',
      },
    ])).toEqual([])

    expect(findDuplicateDesignSystemCss(canonical, [
      canonical,
      {
        path: 'plugins/example/dist/client.css',
        source: `/* copied host styles */\n${canonical.source}\n.card { display: grid; }`,
      },
    ])).toEqual(['plugins/example/dist/client.css'])
  })
})

describe('UI performance ratchet', () => {
  it('excludes Bun checkout-path module labels from otherwise identical client bytes', () => {
    const local = '// ../bakin-bits-official/plugins/example/client.tsx\nconst value = 1;\n'
    const ci = '// ../../../../runner/external/bakin-bits-official/plugins/example/client.tsx\nconst value = 1;\n'

    expect(measureStableBuiltJsBytes(local)).toBe(measureStableBuiltJsBytes(ci))
    expect(measureStableBuiltJsBytes(local)).toBe(Buffer.byteLength('const value = 1;\n'))
  })

  it('counts minified static and side-effect chunks once in reachable entrypoint bytes', () => {
    const root = fixtureRoot()
    writeFixture(root, 'vendor/entry.js', 'import{a}from"./shared.js";import"./side.js";export{a};')
    writeFixture(root, 'vendor/shared.js', 'import"./side.js";export const a=1;')
    writeFixture(root, 'vendor/side.js', 'export const side=1;')

    expect(measureReachableJsBytes(join(root, 'vendor/entry.js'), join(root, 'vendor'))).toBe(
      Buffer.byteLength('import{a}from"./shared.js";import"./side.js";export{a};')
      + Buffer.byteLength('import"./side.js";export const a=1;')
      + Buffer.byteLength('export const side=1;'),
    )
  })

  it('allows a smaller content-hashed shared-chunk set and rejects aggregate growth', () => {
    const baseline = snapshot({
      vendorChunks: [
        { path: 'packages/host/public/vendor/sdk-shared-oldhash.js', bytes: 70 },
        { path: 'packages/host/public/vendor/sdk-shared-otherold.js', bytes: 30 },
      ],
    })
    const reduced = snapshot({
      vendorChunks: [{ path: 'packages/host/public/vendor/sdk-shared-newhash.js', bytes: 90 }],
    })
    expect(diffUiPerformance(baseline, reduced)).toEqual([])

    const regressed = snapshot({
      vendorChunks: [{ path: 'packages/host/public/vendor/sdk-shared-newhash.js', bytes: 101 }],
    })
    expect(diffUiPerformance(baseline, regressed)).toEqual([
      'SDK shared vendor chunks increased: 100 -> 101',
    ])
  })

  it('allows reductions and rejects every increased or newly introduced payload', () => {
    const baseline = snapshot()
    const reduced = snapshot({
      css: { ...baseline.css, canonicalBytes: 99 },
      hostInitialJs: { ...baseline.hostInitialJs, bytes: 199 },
      sdkUiBundles: [{ ...baseline.sdkUiBundles[0], bytes: 49, reachableBytes: 79 }],
      vendorChunks: [{ ...baseline.vendorChunks[0], bytes: 69 }],
      pluginClients: [{ ...baseline.pluginClients[0], bytes: 89 }],
    })
    expect(diffUiPerformance(baseline, reduced)).toEqual([])

    const regressed = snapshot({
      css: { ...baseline.css, canonicalBytes: 101, copyCount: 2, copyPaths: [...baseline.css.copyPaths, 'plugins/example/dist/client.css'] },
      hostInitialJs: { ...baseline.hostInitialJs, bytes: 201 },
      sdkUiBundles: [
        { ...baseline.sdkUiBundles[0], bytes: 51, reachableBytes: 81 },
        { name: 'sdk-charts', path: 'packages/host/public/vendor/sdk-charts.js', bytes: 10, reachableBytes: 10 },
      ],
      vendorChunks: [
        { ...baseline.vendorChunks[0], bytes: 71 },
        { path: 'packages/host/public/vendor/new.js', bytes: 1 },
      ],
      pluginClients: [
        { ...baseline.pluginClients[0], bytes: 91 },
        { repository: 'bakin-bits-official', pluginId: 'new', path: 'bakin-bits-official/plugins/new/dist/client.js', bytes: 1 },
      ],
    })

    expect(diffUiPerformance(baseline, regressed)).toEqual([
      'design-system CSS bytes increased: 100 -> 101',
      'design-system CSS copies increased: 1 -> 2',
      'initial host JS increased: 200 -> 201',
      'SDK UI bundle increased: sdk-ui bytes 50 -> 51',
      'SDK UI bundle reachable bytes increased: sdk-ui 80 -> 81',
      'new SDK UI bundle: sdk-charts (10 bytes)',
      'vendor chunk increased: packages/host/public/vendor/react.js 70 -> 71',
      'new vendor chunk: packages/host/public/vendor/new.js (1 bytes)',
      'plugin client increased: bakin:tasks 90 -> 91',
      'new plugin client: bakin-bits-official:new (1 bytes)',
    ])
  })
})
