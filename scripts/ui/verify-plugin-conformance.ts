import { resolve } from 'node:path'

import {
  formatPluginUiFinding,
  runPluginUiConformance,
  type PluginUiConformanceRule,
} from '@makinbakin/sdk/testing/ui/conformance'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const FIXTURE_ROOT = 'tests/fixtures/plugin-ui-conformance'
const REPORT_ROOT = 'test-results/plugin-ui-conformance'

interface TeethFixture {
  name: string
  pluginId: string
  fixtureEntry?: string
  expectedRules: PluginUiConformanceRule[]
  expectedMessages: string[]
}

const fixtures: TeethFixture[] = [
  { name: 'pass', pluginId: 'fixture-pass', expectedRules: [], expectedMessages: [] },
  {
    name: 'fail-css',
    pluginId: 'fixture-fail-css',
    expectedRules: ['css-scope'],
    expectedMessages: ['document selector'],
  },
  {
    name: 'fail-stylesheet',
    pluginId: 'fixture-fail-stylesheet',
    expectedRules: ['stylesheet-identity'],
    expectedMessages: ['does not import @makinbakin/sdk/styles.css'],
  },
  {
    name: 'fail-stylesheet-duplicate',
    pluginId: 'fixture-fail-stylesheet-copy',
    expectedRules: ['stylesheet-identity'],
    expectedMessages: ['imports @makinbakin/sdk/styles.css 2 times', 'reserved design-system property'],
  },
  {
    name: 'fail-browser',
    pluginId: 'fixture-fail-browser',
    expectedRules: ['overflow', 'axe', 'keyboard-focus', 'console'],
    expectedMessages: ['wider than', 'discernible text', 'removed from keyboard order', 'Seeded fixture console failure'],
  },
  {
    name: 'reference-plugin',
    pluginId: 'reference-bookmarks',
    fixtureEntry: 'examples/reference-plugin/tests/ui.fixture.tsx',
    expectedRules: [],
    expectedMessages: [],
  },
]

function uniqueRules(rules: readonly PluginUiConformanceRule[]): PluginUiConformanceRule[] {
  return [...new Set(rules)].sort()
}

async function main(): Promise<void> {
  for (const fixture of fixtures) {
    const report = await runPluginUiConformance({
      cwd: REPO_ROOT,
      config: {
        pluginId: fixture.pluginId,
        fixtureEntry: fixture.fixtureEntry ?? `${FIXTURE_ROOT}/${fixture.name}/fixture.tsx`,
        reportDir: `${REPORT_ROOT}/${fixture.name}`,
      },
    })
    const actualRules = uniqueRules(report.findings.map((finding) => finding.rule))
    const expectedRules = uniqueRules(fixture.expectedRules)
    if (JSON.stringify(actualRules) !== JSON.stringify(expectedRules)) {
      console.error(`✗ ${fixture.name}: expected ${expectedRules.join(', ') || 'no findings'}; received ${actualRules.join(', ') || 'no findings'}`)
      for (const finding of report.findings) console.error(`  ${formatPluginUiFinding(finding)}`)
      process.exitCode = 1
      continue
    }
    const messages = report.findings.map((finding) => finding.message).join('\n')
    const missingMessages = fixture.expectedMessages.filter((expected) => !messages.includes(expected))
    if (missingMessages.length > 0) {
      console.error(`✗ ${fixture.name}: missing expected evidence: ${missingMessages.join(', ')}`)
      for (const finding of report.findings) console.error(`  ${formatPluginUiFinding(finding)}`)
      process.exitCode = 1
      continue
    }
    console.log(`✓ ${fixture.name}: ${expectedRules.join(', ') || 'clean fixture passed'}`)
  }
  if (process.exitCode) return
  console.log(`Plugin UI conformance verified. Reports: ${resolve(REPO_ROOT, REPORT_ROOT)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
