import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('focused chart foundation', () => {
  it('publishes charts only from the opt-in entrypoint and private chart package', () => {
    const focused = read('packages/sdk/src/charts/index.ts')
    const base = [
      read('packages/sdk/src/ui/index.ts'),
      read('packages/sdk/src/layout/index.ts'),
      read('packages/sdk/src/patterns/index.ts'),
      read('packages/ui/src/index.ts'),
    ].join('\n')
    const manifest = JSON.parse(read('packages/ui/package.json')) as { exports: Record<string, string> }

    expect(focused).toContain("from '@bakin/ui/charts'")
    expect(focused).toContain('ChartDataTable')
    expect(focused).toContain('Sparkline')
    expect(focused).toContain('LineChart')
    expect(focused).toContain('BarChart')
    expect(focused).toContain('StackedColumnChart')
    expect(manifest.exports['./charts']).toBe('./src/charts/index.ts')
    expect(base).not.toMatch(/(?:^|\/)charts(?:\/|')/m)
  })

  it('keeps chart presentation host-independent and legacy modules as adapters', () => {
    const sources = [
      read('packages/ui/src/charts/chart-data-table.tsx'),
      read('packages/ui/src/charts/chart-explainer.tsx'),
      read('packages/ui/src/charts/chart-tooltip.tsx'),
      read('packages/ui/src/charts/line-chart.tsx'),
      read('packages/ui/src/charts/bar-chart.tsx'),
      read('packages/ui/src/charts/palette.ts'),
      read('packages/ui/src/charts/sparkline.tsx'),
      read('packages/ui/src/charts/stacked-column-chart.tsx'),
    ].join('\n')
    expect(sources).not.toMatch(/@\/|@makinbakin\/sdk|\b(?:window|document)\.(?:location|body|documentElement|addEventListener|removeEventListener|querySelector)/)
    expect(sources).not.toMatch(/#[0-9a-f]{3,8}\b/i)

    expect(sources).not.toMatch(/var\(--(?:border|ring|card|background|foreground|muted-foreground)\)/)

    for (const file of [
      'bar-chart.tsx',
      'chart-data-table.tsx',
      'chart-explainer.tsx',
      'line-chart.tsx',
      'palette.ts',
      'sparkline.tsx',
      'stacked-column-chart.tsx',
    ]) {
      expect(read(`src/components/charts/${file}`)).toContain("@makinbakin/sdk/charts")
    }
  })

  it('documents exact data, stable palette assignment, gaps, and non-color meaning', () => {
    const guide = read('docs/src/content/docs/extending/ui/overview.md')
    expect(guide).toContain('@makinbakin/sdk/charts')
    expect(guide).toContain('exact data')
    expect(guide).toContain('full entity set')
    expect(guide).toContain('missing')
    expect(guide).toContain('color alone')
    expect(guide).toContain('Use `LineChart`')
    expect(guide).toContain('keyboard-scrollable plot boundary')
  })
})
