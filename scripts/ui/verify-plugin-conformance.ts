import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

export type OfficialPluginUiEnrollment =
  | { id: string; root: string; status: 'conformant'; migrationTask: string }
  | { id: string; root: string; status: 'migration-pending'; migrationTask: string }
  | { id: string; root: string; status: 'server-only'; reason: string }

/**
 * Explicit coverage for every first-party package that can ship plugin UI.
 * Migration-pending entries are named debt, not skipped checks: each migration
 * replaces its status with `conformant` and adds a package-root UI config.
 */
export const CORE_PLUGIN_UI_ENROLLMENT: readonly OfficialPluginUiEnrollment[] = [
  { id: 'reference-bookmarks', root: 'examples/reference-plugin', status: 'conformant', migrationTask: 'T42a' },
  { id: 'assets', root: 'plugins/assets', status: 'migration-pending', migrationTask: 'T53-T54' },
  { id: 'brands', root: 'plugins/brands', status: 'migration-pending', migrationTask: 'T55-T56' },
  { id: 'chat', root: 'plugins/chat', status: 'migration-pending', migrationTask: 'T59-T60' },
  { id: 'explore', root: 'plugins/explore', status: 'migration-pending', migrationTask: 'T57-T58' },
  { id: 'git', root: 'plugins/git', status: 'server-only', reason: 'No browser client entrypoint.' },
  { id: 'health', root: 'plugins/health', status: 'migration-pending', migrationTask: 'T46' },
  { id: 'images', root: 'plugins/images', status: 'server-only', reason: 'No browser client entrypoint.' },
  { id: 'memory', root: 'plugins/memory', status: 'migration-pending', migrationTask: 'T51-T52' },
  { id: 'models', root: 'plugins/models', status: 'migration-pending', migrationTask: 'T49-T50' },
  { id: 'schedule', root: 'plugins/schedule', status: 'migration-pending', migrationTask: 'T47-T48' },
  { id: 'tasks', root: 'plugins/tasks', status: 'migration-pending', migrationTask: 'T45' },
  { id: 'team', root: 'plugins/team', status: 'migration-pending', migrationTask: 'T61-T62' },
  { id: 'workflows', root: 'plugins/workflows', status: 'migration-pending', migrationTask: 'T63-T66' },
] as const

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

function manifestId(root: string, packageRoot: string): string | undefined {
  const path = join(root, packageRoot, 'bakin-plugin.json')
  if (!existsSync(path)) return undefined
  return (JSON.parse(readFileSync(path, 'utf8')) as { id?: string }).id
}

/** Refuse silent omissions, fake server-only labels, and unconfigured graduates. */
export function validateCorePluginUiEnrollment(
  root = REPO_ROOT,
  enrollment: readonly OfficialPluginUiEnrollment[] = CORE_PLUGIN_UI_ENROLLMENT,
): string[] {
  const errors: string[] = []
  const discovered = readdirSync(join(root, 'plugins'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(root, 'plugins', entry.name, 'bakin-plugin.json')))
    .map((entry) => `plugins/${entry.name}`)
  if (existsSync(join(root, 'examples/reference-plugin/bakin-plugin.json'))) {
    discovered.push('examples/reference-plugin')
  }

  const byRoot = new Map(enrollment.map((entry) => [entry.root, entry]))
  for (const packageRoot of discovered.sort()) {
    if (!byRoot.has(packageRoot)) errors.push(`${packageRoot} is missing from official plugin UI enrollment`)
  }
  for (const entry of enrollment) {
    const absoluteRoot = join(root, entry.root)
    if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
      errors.push(`${entry.id} enrollment root does not exist: ${entry.root}`)
      continue
    }
    if (!discovered.includes(entry.root)) errors.push(`${entry.id} enrollment is stale: ${entry.root}`)
    const actualId = manifestId(root, entry.root)
    if (actualId !== entry.id) errors.push(`${entry.root} manifest id is ${actualId ?? '<missing>'}, expected ${entry.id}`)

    const hasClient = existsSync(join(absoluteRoot, 'client.tsx')) || existsSync(join(absoluteRoot, 'client.ts'))
    if (entry.status === 'server-only') {
      if (hasClient) errors.push(`${entry.id} is labeled server-only but has a browser client entrypoint`)
      continue
    }
    if (!hasClient) errors.push(`${entry.id} is ${entry.status} but has no browser client entrypoint`)
    if (entry.status === 'conformant' && !existsSync(join(absoluteRoot, 'bakin.ui-test.ts'))) {
      errors.push(`${entry.id} is conformant but has no bakin.ui-test.ts`)
    }
  }

  const runnableIds = new Set(fixtures.filter((fixture) => fixture.name === 'reference-plugin').map((fixture) => fixture.pluginId))
  for (const entry of enrollment) {
    if (entry.status === 'conformant' && !runnableIds.has(entry.id)) {
      errors.push(`${entry.id} is conformant but is not run by the official conformance suite`)
    }
  }
  return errors.sort((left, right) => left.localeCompare(right))
}

function uniqueRules(rules: readonly PluginUiConformanceRule[]): PluginUiConformanceRule[] {
  return [...new Set(rules)].sort()
}

async function main(): Promise<void> {
  const enrollmentErrors = validateCorePluginUiEnrollment()
  if (enrollmentErrors.length > 0) {
    throw new Error(`Official core plugin UI enrollment is invalid:\n${enrollmentErrors.map((error) => `- ${error}`).join('\n')}`)
  }

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
  for (const entry of CORE_PLUGIN_UI_ENROLLMENT) {
    if (entry.status === 'migration-pending') {
      console.log(`↷ ${entry.id}: enrolled; conformance becomes required with ${entry.migrationTask}`)
    } else if (entry.status === 'server-only') {
      console.log(`— ${entry.id}: server-only — ${entry.reason}`)
    }
  }
  if (process.exitCode) return
  console.log(`Plugin UI conformance verified. Reports: ${resolve(REPO_ROOT, REPORT_ROOT)}`)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
