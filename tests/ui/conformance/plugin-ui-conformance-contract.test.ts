import { describe, expect, it } from 'bun:test'

import {
  PLUGIN_UI_CONFORMANCE_RULES,
  definePluginUiConformance,
  formatPluginUiFinding,
  renderPluginUiConformanceHtml,
  type PluginUiConformanceFinding,
  type PluginUiConformanceReport,
} from '@makinbakin/sdk/testing/ui/conformance'
import {
  formatFixtureBuildFailure,
  formatFixtureReadyFailure,
} from '../../../packages/sdk/src/testing/ui/conformance/runner'

const finding = (overrides: Partial<PluginUiConformanceFinding> = {}): PluginUiConformanceFinding => ({
  rule: 'overflow',
  enforcement: 'conformance',
  message: 'The document is 24px wider than the mobile viewport.',
  repair: 'Keep wide content inside BoundedOverflow and remove page-level fixed widths.',
  fixture: 'primary',
  viewport: 'mobile',
  ...overrides,
})

describe('plugin UI conformance public contract', () => {
  it('names every promised rule and keeps package blockers narrow', () => {
    expect(PLUGIN_UI_CONFORMANCE_RULES).toEqual([
      'css-scope',
      'stylesheet-identity',
      'overflow',
      'axe',
      'keyboard-focus',
      'console',
    ])

    expect(finding({ rule: 'css-scope', enforcement: 'package' }).enforcement).toBe('package')
    expect(finding({ rule: 'stylesheet-identity', enforcement: 'package' }).enforcement).toBe('package')
    for (const rule of ['overflow', 'axe', 'keyboard-focus', 'console'] as const) {
      expect(finding({ rule }).enforcement).toBe('conformance')
    }
  })

  it('defines a portable external-plugin config with stable defaults', () => {
    expect(definePluginUiConformance({
      pluginId: 'release-tools',
      fixtureEntry: './tests/ui.fixture.tsx',
    })).toEqual({
      pluginId: 'release-tools',
      fixtureEntry: './tests/ui.fixture.tsx',
      reportDir: 'test-results/bakin-ui',
      readySelector: '[data-bakin-plugin-fixture-host]',
      timeoutMs: 10_000,
    })

    expect(() => definePluginUiConformance({
      pluginId: 'Bad Plugin',
      fixtureEntry: './tests/ui.fixture.tsx',
    })).toThrow('pluginId')
    expect(definePluginUiConformance({
      pluginId: '_template',
      fixtureEntry: './tests/ui.fixture.tsx',
    }).pluginId).toBe('_template')
    expect(() => definePluginUiConformance({
      pluginId: '_other',
      fixtureEntry: './tests/ui.fixture.tsx',
    })).toThrow('pluginId')
    expect(() => definePluginUiConformance({
      pluginId: 'release-tools',
      fixtureEntry: '/tmp/escape.tsx',
    })).toThrow('fixtureEntry')
    expect(() => definePluginUiConformance({
      pluginId: 'release-tools',
      fixtureEntry: '../escape.tsx',
    })).toThrow('fixtureEntry')
  })

  it('formats each finding with concrete location and repair guidance', () => {
    expect(formatPluginUiFinding(finding())).toBe(
      '[overflow] primary/mobile: The document is 24px wider than the mobile viewport. ' +
      'Repair: Keep wide content inside BoundedOverflow and remove page-level fixed widths.',
    )
  })

  it('renders a self-contained escaped HTML report with screenshot evidence', () => {
    const report: PluginUiConformanceReport = {
      schemaVersion: 1,
      pluginId: 'release-tools',
      generatedAt: '2026-07-22T12:00:00.000Z',
      status: 'failed',
      reportDir: 'test-results/bakin-ui',
      findings: [finding({ message: 'Unsafe <button> & label' })],
      screenshots: [
        { fixture: 'primary', viewport: 'desktop', path: 'screenshots/primary-desktop.png' },
      ],
    }
    const html = renderPluginUiConformanceHtml(report)

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Unsafe &lt;button&gt; &amp; label')
    expect(html).toContain('screenshots/primary-desktop.png')
    expect(html).toContain('<img src="screenshots/primary-desktop.png"')
    expect(html).not.toContain('Unsafe <button>')
    expect(html).toContain('Package/install blockers')
    expect(html).toContain('Conformance-only findings')
  })

  it('rejects report targets that could erase or escape the plugin root', () => {
    for (const reportDir of ['.', './', '..', '../outside', '/tmp/outside', 'C:\\outside']) {
      expect(() => definePluginUiConformance({
        pluginId: 'release-tools',
        fixtureEntry: './tests/ui.fixture.tsx',
        reportDir,
      })).toThrow('reportDir')
    }
  })

  it('preserves actionable build and readiness diagnostics', () => {
    expect(formatFixtureBuildFailure({
      message: 'Bundle failed',
      logs: ['Could not resolve react/jsx-runtime at fixture.tsx:4:2'],
    })).toContain('Could not resolve react/jsx-runtime at fixture.tsx:4:2')

    const readyFailure = formatFixtureReadyFailure(
      '[data-plugin-ready]',
      2_000,
      [{ kind: 'pageerror', message: 'jsxDEV is not a function' }],
      'Plugin fixture crashed',
      new Error('Timeout 2000ms exceeded'),
    )
    expect(readyFailure).toContain('ready selector "[data-plugin-ready]" within 2000ms')
    expect(readyFailure).toContain('pageerror: jsxDEV is not a function')
    expect(readyFailure).toContain('Rendered body: Plugin fixture crashed')
  })
})
