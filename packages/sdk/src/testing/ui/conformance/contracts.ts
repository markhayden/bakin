import {
  AUTHOR_TEMPLATE_PLUGIN_ID,
  isPluginUiOwnerId,
  PUBLISHED_PLUGIN_ID_PATTERN,
} from './plugin-id'

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replaceAll('\\', '/')
  return normalized.length > 0
    && normalized !== '.'
    && normalized !== './'
    && !normalized.startsWith('/')
    && !WINDOWS_ABSOLUTE.test(value)
    && !normalized.split('/').includes('..')
}

/** Stable rule identifiers emitted by the plugin UI conformance harness. */
export const PLUGIN_UI_CONFORMANCE_RULES = [
  'css-scope',
  'stylesheet-identity',
  'overflow',
  'axe',
  'keyboard-focus',
  'console',
] as const

/** One enforceable rule family in a plugin UI report. */
export type PluginUiConformanceRule = (typeof PLUGIN_UI_CONFORMANCE_RULES)[number]
/** Package rules can block installation; conformance rules block CI/release only. */
export type PluginUiConformanceEnforcement = 'package' | 'conformance'

/** Author input for the one-command plugin UI harness. */
export interface PluginUiConformanceConfigInput {
  /** Manifest plugin id used for CSS and DOM ownership. */
  pluginId: string
  /** Root-relative TS/TSX browser entry that mounts `PluginUiFixtureHost`. */
  fixtureEntry: string
  /** Root-relative report directory. Defaults to `test-results/bakin-ui`. */
  reportDir?: string
  /** Selector that proves the deterministic fixture finished mounting. */
  readySelector?: string
  /** Per-navigation and readiness timeout. */
  timeoutMs?: number
}

/** Normalized, complete harness configuration. */
export interface PluginUiConformanceConfig {
  pluginId: string
  fixtureEntry: string
  reportDir: string
  readySelector: string
  timeoutMs: number
}

/** One actionable conformance failure. */
export interface PluginUiConformanceFinding {
  rule: PluginUiConformanceRule
  enforcement: PluginUiConformanceEnforcement
  message: string
  repair: string
  fixture?: string
  viewport?: 'desktop' | 'mobile'
  file?: string
  line?: number
  column?: number
}

/** Screenshot evidence captured without making image changes an automatic failure. */
export interface PluginUiConformanceScreenshot {
  fixture: string
  viewport: 'desktop' | 'mobile'
  path: string
}

/** Machine-readable result mirrored by the human-readable HTML report. */
export interface PluginUiConformanceReport {
  schemaVersion: 1
  pluginId: string
  generatedAt: string
  status: 'passed' | 'failed'
  /** Configured root-relative directory containing this report. */
  reportDir: string
  findings: PluginUiConformanceFinding[]
  screenshots: PluginUiConformanceScreenshot[]
}

/** Inputs for running a plugin fixture from a package root. */
export interface RunPluginUiConformanceOptions {
  /** Absolute or process-relative plugin package root. Defaults to cwd. */
  cwd?: string
  /** Root-relative config module. Defaults to `bakin.ui-test.ts`. */
  configPath?: string
  /** Preloaded config for programmatic runners; mutually exclusive with configPath. */
  config?: PluginUiConformanceConfigInput | PluginUiConformanceConfig
  /** Override the Chromium executable used by Playwright. */
  browserExecutablePath?: string
}

/** Validate author input and apply stable local/CI defaults. */
export function definePluginUiConformance(
  input: PluginUiConformanceConfigInput,
): PluginUiConformanceConfig {
  if (!isPluginUiOwnerId(input.pluginId)) {
    throw new Error(`pluginId must match ${PUBLISHED_PLUGIN_ID_PATTERN} (the reserved ${AUTHOR_TEMPLATE_PLUGIN_ID} scaffold is also accepted)`)
  }
  for (const [field, value] of [
    ['fixtureEntry', input.fixtureEntry],
    ['reportDir', input.reportDir ?? 'test-results/bakin-ui'],
  ] as const) {
    if (!isSafeRelativePath(value)) {
      throw new Error(`${field} must be a plugin-root-relative path without ".." segments`)
    }
  }
  if (input.readySelector !== undefined && input.readySelector.trim().length === 0) {
    throw new Error('readySelector must be a non-empty CSS selector')
  }
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 1)) {
    throw new Error('timeoutMs must be a positive finite number')
  }
  return {
    pluginId: input.pluginId,
    fixtureEntry: input.fixtureEntry,
    reportDir: input.reportDir ?? 'test-results/bakin-ui',
    readySelector: input.readySelector ?? '[data-bakin-plugin-fixture-host]',
    timeoutMs: input.timeoutMs ?? 10_000,
  }
}

function findingLocation(finding: PluginUiConformanceFinding): string {
  if (finding.file) {
    const line = finding.line === undefined ? '' : `:${finding.line}`
    const column = finding.column === undefined ? '' : `:${finding.column}`
    return `${finding.file}${line}${column}`
  }
  if (finding.fixture && finding.viewport) return `${finding.fixture}/${finding.viewport}`
  return finding.fixture ?? finding.viewport ?? 'plugin'
}

/** Format one finding for terminals, logs, and PR annotations. */
export function formatPluginUiFinding(finding: PluginUiConformanceFinding): string {
  const message = /[.!?]$/.test(finding.message) ? finding.message : `${finding.message}.`
  return `[${finding.rule}] ${findingLocation(finding)}: ${message} Repair: ${finding.repair}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function findingList(findings: readonly PluginUiConformanceFinding[]): string {
  if (findings.length === 0) return '<p>None.</p>'
  return `<ol>${findings.map((finding) => (
    `<li><p><strong>${escapeHtml(finding.rule)}</strong> — ${escapeHtml(findingLocation(finding))}</p>` +
    `<p>${escapeHtml(finding.message)}</p><p><strong>Repair:</strong> ${escapeHtml(finding.repair)}</p></li>`
  )).join('')}</ol>`
}

/** Render a portable, dependency-free HTML report beside JSON and screenshots. */
export function renderPluginUiConformanceHtml(report: PluginUiConformanceReport): string {
  const packageFindings = report.findings.filter((finding) => finding.enforcement === 'package')
  const conformanceFindings = report.findings.filter((finding) => finding.enforcement === 'conformance')
  const screenshots = report.screenshots.length === 0
    ? '<p>No screenshots were captured.</p>'
    : `<div class="screenshots">${report.screenshots.map((screenshot) => (
        `<figure><a href="${escapeHtml(screenshot.path)}"><img src="${escapeHtml(screenshot.path)}" alt="${escapeHtml(`${screenshot.fixture} ${screenshot.viewport} fixture screenshot`)}"></a>` +
        `<figcaption>${escapeHtml(`${screenshot.fixture} / ${screenshot.viewport}`)}</figcaption></figure>`
      )).join('')}</div>`

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.pluginId)} UI conformance</title>
  <style>
    body { margin: 0 auto; max-width: 72rem; padding: 2rem; color: CanvasText; background: Canvas; font-family: system-ui, sans-serif; line-height: 1.5; }
    main { display: grid; gap: 1.5rem; }
    section { padding-block: 1rem; border-top: 1px solid currentColor; }
    code, strong { font-weight: 700; }
    li { margin-block: 1rem; }
    li p { margin-block: .25rem; }
    .screenshots { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 1rem; }
    figure { margin: 0; }
    img { display: block; width: 100%; max-height: 36rem; object-fit: contain; object-position: top; border: 1px solid currentColor; }
    figcaption { margin-block-start: .5rem; }
  </style>
</head>
<body>
  <main>
    <header><p>Plugin UI conformance</p><h1>${escapeHtml(report.pluginId)}</h1><p>Status: <strong>${escapeHtml(report.status)}</strong></p></header>
    <section><h2>Package/install blockers</h2>${findingList(packageFindings)}</section>
    <section><h2>Conformance-only findings</h2>${findingList(conformanceFindings)}</section>
    <section><h2>Screenshot evidence</h2>${screenshots}</section>
  </main>
</body>
</html>
`
}
