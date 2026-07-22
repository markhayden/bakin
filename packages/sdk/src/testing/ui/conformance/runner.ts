import { createRequire } from 'node:module'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { PLUGIN_UI_VIEWPORTS } from '../runtime'
import {
  definePluginUiConformance,
  renderPluginUiConformanceHtml,
  type PluginUiConformanceConfig,
  type PluginUiConformanceConfigInput,
  type PluginUiConformanceFinding,
  type PluginUiConformanceReport,
  type PluginUiConformanceScreenshot,
  type RunPluginUiConformanceOptions,
} from './contracts'
import { PluginCssValidationError, transformPluginCss } from './plugin-css'

const FIXTURE_NAME = 'primary'
const SDK_STYLES_SPECIFIER = '@makinbakin/sdk/styles.css'
const SDK_STYLES_NAMESPACE = 'bakin-sdk-styles'

interface BrowserConsoleError {
  kind: 'console' | 'pageerror' | 'requestfailed'
  message: string
}

interface BrowserInspection {
  overflow: { clientWidth: number; scrollWidth: number }
  unreachable: string[]
  axe: Array<{
    id: string
    impact: string | null
    help: string
    helpUrl: string
    targets: string[]
  }>
}

interface BuiltFixture {
  entryPath: string
  cssPaths: string[]
  sdkStylesheetImports: number
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

function resolveWithin(root: string, path: string, label: string): string {
  const candidate = resolve(root, path)
  if (!isWithin(root, candidate)) {
    throw new Error(`${label} must resolve inside the plugin package root`)
  }
  return candidate
}

function resolveExistingWithin(root: string, path: string, label: string): string {
  const candidate = resolveWithin(root, path, label)
  if (!existsSync(candidate)) return candidate
  const real = realpathSync(candidate)
  if (!isWithin(root, real)) throw new Error(`${label} resolves outside the plugin package root`)
  return real
}

function resolveWritableWithin(root: string, path: string, label: string): string {
  const candidate = resolveWithin(root, path, label)
  let ancestor = candidate
  while (!existsSync(ancestor)) ancestor = resolve(ancestor, '..')
  const realAncestor = realpathSync(ancestor)
  const realCandidate = resolve(realAncestor, relative(ancestor, candidate))
  if (!isWithin(root, realCandidate)) throw new Error(`${label} resolves outside the plugin package root`)
  return realCandidate
}

function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(path))
    else files.push(path)
  }
  return files
}

function browserPath(root: string, path: string): string {
  return `/${relative(root, path).split(sep).join('/')}`
}

function mimeType(path: string): string {
  switch (extname(path)) {
    case '.css': return 'text/css; charset=utf-8'
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.png': return 'image/png'
    case '.svg': return 'image/svg+xml'
    case '.woff2': return 'font/woff2'
    default: return 'application/octet-stream'
  }
}

async function loadConfig(
  root: string,
  options: RunPluginUiConformanceOptions,
): Promise<PluginUiConformanceConfig> {
  if (options.config && options.configPath) {
    throw new Error('config and configPath are mutually exclusive')
  }
  if (options.config) return definePluginUiConformance(options.config)

  const configPath = resolveExistingWithin(root, options.configPath ?? 'bakin.ui-test.ts', 'configPath')
  if (!existsSync(configPath)) {
    throw new Error(`Plugin UI config not found: ${configPath}`)
  }
  const module = await import(`${pathToFileURL(configPath).href}?bakin-ui=${Date.now()}`) as {
    default?: PluginUiConformanceConfigInput
  }
  if (!module.default) throw new Error(`${configPath} must export a default plugin UI config`)
  return definePluginUiConformance(module.default)
}

async function buildFixture(
  root: string,
  config: PluginUiConformanceConfig,
  stageDir: string,
): Promise<BuiltFixture> {
  const entry = resolveExistingWithin(root, config.fixtureEntry, 'fixtureEntry')
  if (!existsSync(entry) || !statSync(entry).isFile()) {
    throw new Error(`Plugin UI fixture entry not found: ${entry}`)
  }

  let sdkStylesheetImports = 0
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: stageDir,
    target: 'browser',
    format: 'esm',
    splitting: true,
    sourcemap: 'none',
    minify: false,
    naming: {
      entry: 'fixture.[ext]',
      chunk: 'chunks/[name]-[hash].[ext]',
      asset: 'assets/[name]-[hash].[ext]',
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'bakin-canonical-stylesheet-identity',
      setup(builder: Bun.PluginBuilder) {
        builder.onResolve({ filter: /^@makinbakin\/sdk\/styles\.css$/ }, () => {
          sdkStylesheetImports += 1
          return { path: SDK_STYLES_SPECIFIER, namespace: SDK_STYLES_NAMESPACE }
        })
        builder.onLoad({ filter: /.*/, namespace: SDK_STYLES_NAMESPACE }, () => ({
          contents: '',
          loader: 'css',
        }))
      },
    }],
  })
  if (!result.success) {
    const details = result.logs.map(String).join('\n')
    throw new Error(`Plugin UI fixture build failed:\n${details}`)
  }

  const files = collectFiles(stageDir)
  const entryPath = files.find((path) => path.endsWith(`${sep}fixture.js`))
  if (!entryPath) throw new Error('Plugin UI fixture build did not emit fixture.js')
  return {
    entryPath,
    cssPaths: files.filter((path) => path.endsWith('.css')),
    sdkStylesheetImports,
  }
}

function stylesheetFindings(
  root: string,
  config: PluginUiConformanceConfig,
  built: BuiltFixture,
): PluginUiConformanceFinding[] {
  const findings: PluginUiConformanceFinding[] = []
  if (built.sdkStylesheetImports !== 1) {
    findings.push({
      rule: 'stylesheet-identity',
      enforcement: 'package',
      fixture: FIXTURE_NAME,
      file: config.fixtureEntry,
      message: built.sdkStylesheetImports === 0
        ? `The fixture does not import ${SDK_STYLES_SPECIFIER}.`
        : `The fixture imports ${SDK_STYLES_SPECIFIER} ${built.sdkStylesheetImports} times.`,
      repair: `Import ${SDK_STYLES_SPECIFIER} exactly once at the fixture root; installed plugin clients leave stylesheet loading to Bakin.`,
    })
  }

  for (const cssPath of built.cssPaths) {
    try {
      const result = transformPluginCss({
        pluginId: config.pluginId,
        css: readFileSync(cssPath, 'utf8'),
        from: cssPath,
        sourceRoot: root,
      })
      writeFileSync(cssPath, result.css)
    } catch (error) {
      if (!(error instanceof PluginCssValidationError)) throw error
      for (const diagnostic of error.diagnostics) {
        const stylesheetIdentity = diagnostic.code === 'reserved-property'
        findings.push({
          rule: stylesheetIdentity ? 'stylesheet-identity' : 'css-scope',
          enforcement: 'package',
          fixture: FIXTURE_NAME,
          file: isWithin(root, diagnostic.file) ? relative(root, diagnostic.file) : diagnostic.file,
          line: diagnostic.line,
          column: diagnostic.column,
          message: diagnostic.message,
          repair: diagnostic.suggestion,
        })
      }
    }
  }
  return findings
}

function prepareReportDirectory(reportDir: string): void {
  mkdirSync(reportDir, { recursive: true })
  for (const name of ['report.json', 'index.html']) {
    rmSync(join(reportDir, name), { force: true })
  }
  rmSync(join(reportDir, 'screenshots'), { recursive: true, force: true })
  mkdirSync(join(reportDir, 'screenshots'), { recursive: true })
}

function writeReport(reportDir: string, report: PluginUiConformanceReport): void {
  writeFileSync(join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(join(reportDir, 'index.html'), renderPluginUiConformanceHtml(report), 'utf8')
}

function buildFixtureHtml(stageDir: string, built: BuiltFixture): string {
  const styles = built.cssPaths.map((path) => (
    `<link rel="stylesheet" data-bakin-plugin-stylesheet href="${browserPath(stageDir, path)}">`
  )).join('\n  ')
  return `<!doctype html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bakin plugin UI conformance fixture</title>
  <link rel="stylesheet" data-bakin-sdk-stylesheet href="./sdk-styles.css">
  ${styles}
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${browserPath(stageDir, built.entryPath)}"></script>
</body>
</html>
`
}

async function createFixtureServer(stageDir: string): Promise<{
  url: string
  stop: () => Promise<void>
}> {
  const handleRequest = (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      response.writeHead(400).end('Bad request')
      return
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const filePath = resolve(stageDir, relativePath)
    if (!isWithin(stageDir, filePath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404).end('Not found')
      return
    }
    response.writeHead(200, { 'content-type': mimeType(filePath) })
    response.end(readFileSync(filePath))
  }
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const server = createServer(handleRequest)
    const port = 40_000 + ((process.pid * 131 + Date.now() + attempt * 977) % 20_000)
    const started = await new Promise<boolean>((resolveReady, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') resolveReady(false)
        else reject(error)
      })
      server.listen(port, '127.0.0.1', () => resolveReady(true))
    })
    if (!started) continue
    return {
      url: `http://127.0.0.1:${port}/`,
      stop: () => new Promise((resolveStopped, reject) => {
        server.close((error) => error ? reject(error) : resolveStopped())
      }),
    }
  }
  throw new Error('Plugin UI fixture server could not reserve a local test port')
}

async function inspectBrowserPage(page: import('playwright').Page): Promise<BrowserInspection> {
  const inspection = await page.evaluate(async () => {
    const root = document.documentElement
    const interactiveSelector = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      '[contenteditable="true"]',
      '[tabindex]',
    ].join(',')
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const label = (element: HTMLElement) => {
      const id = element.id ? `#${element.id}` : ''
      const className = typeof element.className === 'string' && element.className.trim()
        ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : ''
      const accessibleText = element.getAttribute('aria-label') || element.textContent?.trim()
      const text = accessibleText ? ` "${accessibleText.slice(0, 60)}"` : ''
      return `${element.tagName.toLowerCase()}${id}${className}${text}`
    }
    const participatesInRovingFocus = (element: HTMLElement) => {
      const role = element.getAttribute('role')
      const owner = role === 'tab' ? element.closest('[role="tablist"]')
        : role === 'radio' ? element.closest('[role="radiogroup"]')
        : role === 'option' ? element.closest('[role="listbox"]')
        : role?.startsWith('menuitem') ? element.closest('[role="menu"], [role="menubar"]')
        : role === 'treeitem' ? element.closest('[role="tree"]')
        : role === 'gridcell' || role === 'row' ? element.closest('[role="grid"], [role="treegrid"]')
        : element.closest('[role="toolbar"]')
      return Boolean(owner?.querySelector('[tabindex="0"]'))
    }
    const unreachable = [...document.querySelectorAll<HTMLElement>(interactiveSelector)]
      .filter((element) => visible(element))
      .filter((element) => !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true')
      .filter((element) => !element.closest('[inert], [aria-hidden="true"]'))
      .filter((element) => element.tabIndex < 0)
      .filter((element) => !participatesInRovingFocus(element))
      .map(label)

    const axeApi = (globalThis as typeof globalThis & {
      axe?: { run: (context: Document) => Promise<{ violations: Array<{
        id: string
        impact: string | null
        help: string
        helpUrl: string
        nodes: Array<{ target: string[] }>
      }> }> }
    }).axe
    if (!axeApi) throw new Error('axe-core failed to initialize in the fixture browser')
    const axeResult = await axeApi.run(document)
    return {
      overflow: { clientWidth: root.clientWidth, scrollWidth: root.scrollWidth },
      unreachable,
      axe: axeResult.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        targets: violation.nodes.flatMap((node) => node.target),
      })),
    }
  })
  return inspection
}

async function keyboardFocusFindings(
  page: import('playwright').Page,
  viewport: 'desktop' | 'mobile',
): Promise<PluginUiConformanceFinding[]> {
  const targets = await page.evaluate(() => {
    const selector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
    const visibleElements = [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
        && !element.matches(':disabled')
        && element.getAttribute('aria-disabled') !== 'true'
        && element.tabIndex >= 0
        && !element.closest('[inert], [aria-hidden="true"]')
    })
    const radioGroups = new Map<string, HTMLInputElement[]>()
    for (const element of visibleElements) {
      if (!(element instanceof HTMLInputElement) || element.type !== 'radio') continue
      const key = `${element.form?.id ?? ''}\n${element.name}`
      radioGroups.set(key, [...(radioGroups.get(key) ?? []), element])
    }
    const elements = visibleElements.filter((element) => {
      if (!(element instanceof HTMLInputElement) || element.type !== 'radio') return true
      const group = radioGroups.get(`${element.form?.id ?? ''}\n${element.name}`) ?? [element]
      return group.find((radio) => radio.checked) === element || (!group.some((radio) => radio.checked) && group[0] === element)
    })
    const targets = elements.map((element, index) => {
      const id = String(index)
      element.setAttribute('data-bakin-ui-test-focus-id', id)
      const style = getComputedStyle(element)
      return {
        id,
        label: (element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName.toLowerCase()).slice(0, 80),
        resting: {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          color: style.color,
          filter: style.filter,
          outlineColor: style.outlineColor,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          transform: style.transform,
        },
      }
    })
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    document.body.tabIndex = -1
    document.body.focus()
    return targets
  })
  if (targets.length === 0) return []

  const findings: PluginUiConformanceFinding[] = []
  const reached = new Set<string>()
  for (let index = 0; index < targets.length; index += 1) {
    await page.keyboard.press('Tab')
    const focus = await page.evaluate(async (restingById) => {
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
      const element = document.activeElement
      if (!(element instanceof HTMLElement) || element === document.body) {
        return { reached: false, visible: false, id: '', label: 'document body', diagnostic: '' }
      }
      const id = element.getAttribute('data-bakin-ui-test-focus-id') ?? ''
      const resting = restingById[id]
      const style = getComputedStyle(element)
      const outlineWidth = Number.parseFloat(style.outlineWidth) || 0
      const focused = {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
        color: style.color,
        filter: style.filter,
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        transform: style.transform,
      }
      const visibleOutline = style.outlineStyle !== 'none' && outlineWidth > 0
      const outlineChanged = Boolean(resting) && (
        style.outlineColor !== resting.outlineColor
        || style.outlineStyle !== resting.outlineStyle
        || style.outlineWidth !== resting.outlineWidth
      )
      const shadowChanged = Boolean(resting)
        && style.boxShadow !== 'none'
        && style.boxShadow !== resting.boxShadow
      const surfaceChanged = Boolean(resting) && [
        'backgroundColor',
        'borderColor',
        'color',
        'filter',
        'transform',
      ].some((property) => focused[property as keyof typeof focused] !== resting[property as keyof typeof focused])
      const focusVisible = element.matches(':focus-visible')
      const label = element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName.toLowerCase()
      return {
        reached: Boolean(id),
        visible: focusVisible && ((visibleOutline && outlineChanged) || shadowChanged || surfaceChanged),
        id,
        label: label.slice(0, 80),
        diagnostic: `focus-visible=${focusVisible}; outline=${style.outlineStyle} ${style.outlineWidth}; shadow=${style.boxShadow}`,
      }
    }, Object.fromEntries(targets.map((target) => [target.id, target.resting])))

    if (!focus.reached) {
      const missing = targets
        .filter((target) => !reached.has(target.id))
        .map((target) => target.label)
        .join(', ')
      findings.push({
        rule: 'keyboard-focus',
        enforcement: 'conformance',
        fixture: FIXTURE_NAME,
        viewport,
        message: `Tab left the visible fixture controls after reaching ${reached.size} of ${targets.length}. Missing: ${missing}.`,
        repair: 'Use native interactive elements or a documented SDK control and preserve its complete tab order.',
      })
      break
    }
    if (reached.has(focus.id)) {
      const missing = targets
        .filter((target) => !reached.has(target.id))
        .map((target) => target.label)
        .join(', ')
      findings.push({
        rule: 'keyboard-focus',
        enforcement: 'conformance',
        fixture: FIXTURE_NAME,
        viewport,
        message: `Keyboard focus cycled before reaching all visible controls (${reached.size} of ${targets.length}). Missing: ${missing}.`,
        repair: 'Remove focus traps from the page fixture or place them inside a documented modal interaction.',
      })
      break
    }
    reached.add(focus.id)
    if (!focus.visible) findings.push({
      rule: 'keyboard-focus',
      enforcement: 'conformance',
      fixture: FIXTURE_NAME,
      viewport,
      message: `Keyboard target (${focus.label}) has no detectable focus indicator (${focus.diagnostic}).`,
      repair: 'Keep the SDK focus ring or provide an equally visible :focus-visible treatment.',
    })
  }
  await page.evaluate(() => {
    document.querySelectorAll('[data-bakin-ui-test-focus-id]').forEach((element) => (
      element.removeAttribute('data-bakin-ui-test-focus-id')
    ))
  })
  return findings
}

function browserInspectionFindings(
  inspection: BrowserInspection,
  viewport: 'desktop' | 'mobile',
): PluginUiConformanceFinding[] {
  const findings: PluginUiConformanceFinding[] = []
  if (inspection.overflow.scrollWidth > inspection.overflow.clientWidth) {
    findings.push({
      rule: 'overflow',
      enforcement: 'conformance',
      fixture: FIXTURE_NAME,
      viewport,
      message: `The document is ${inspection.overflow.scrollWidth - inspection.overflow.clientWidth}px wider than the ${inspection.overflow.clientWidth}px viewport.`,
      repair: 'Remove page-level fixed widths or contain intentionally wide content with the SDK bounded-overflow pattern.',
    })
  }
  if (inspection.unreachable.length > 0) {
    findings.push({
      rule: 'keyboard-focus',
      enforcement: 'conformance',
      fixture: FIXTURE_NAME,
      viewport,
      message: `Visible interactive controls are removed from keyboard order: ${inspection.unreachable.join(', ')}.`,
      repair: 'Remove negative tabIndex from user-operable controls or replace the element with a documented SDK interaction pattern.',
    })
  }
  for (const violation of inspection.axe) {
    findings.push({
      rule: 'axe',
      enforcement: 'conformance',
      fixture: FIXTURE_NAME,
      viewport,
      message: `${violation.help} (${violation.id}, ${violation.impact ?? 'unknown'}): ${violation.targets.slice(0, 3).join(', ')}.`,
      repair: `Follow ${violation.helpUrl} and use the corresponding accessible SDK primitive where one exists.`,
    })
  }
  return findings
}

async function runBrowserChecks(
  serverUrl: string,
  root: string,
  config: PluginUiConformanceConfig,
  reportDir: string,
  browserExecutablePath?: string,
): Promise<{ findings: PluginUiConformanceFinding[]; screenshots: PluginUiConformanceScreenshot[] }> {
  const require = createRequire(join(root, 'package.json'))
  let playwright: typeof import('playwright')
  let axeSource: string
  try {
    playwright = await import('playwright')
    axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
  } catch (error) {
    throw new Error(
      `Plugin UI browser checks require playwright and axe-core as plugin devDependencies. ` +
      `Install both, then run bunx playwright install chromium. (${String(error)})`,
    )
  }
  const browser = await playwright.chromium.launch({
    headless: true,
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
  })
  const findings: PluginUiConformanceFinding[] = []
  const screenshots: PluginUiConformanceScreenshot[] = []
  try {
    for (const viewport of ['desktop', 'mobile'] as const) {
      const errors: BrowserConsoleError[] = []
      const context = await browser.newContext({
        viewport: PLUGIN_UI_VIEWPORTS[viewport],
        colorScheme: 'dark',
        reducedMotion: 'reduce',
      })
      await context.addInitScript({ content: axeSource })
      const page = await context.newPage()
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push({ kind: 'console', message: message.text() })
      })
      page.on('pageerror', (error) => errors.push({ kind: 'pageerror', message: error.message }))
      page.on('requestfailed', (request) => errors.push({
        kind: 'requestfailed',
        message: `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.trim(),
      }))

      await page.goto(serverUrl, { waitUntil: 'networkidle', timeout: config.timeoutMs })
      await page.locator(config.readySelector).waitFor({ state: 'visible', timeout: config.timeoutMs })

      const screenshotPath = join(reportDir, 'screenshots', `${FIXTURE_NAME}-${viewport}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true })
      screenshots.push({
        fixture: FIXTURE_NAME,
        viewport,
        path: `screenshots/${FIXTURE_NAME}-${viewport}.png`,
      })

      const inspection = await inspectBrowserPage(page)
      findings.push(...browserInspectionFindings(inspection, viewport))
      findings.push(...await keyboardFocusFindings(page, viewport))

      for (const error of errors) {
        findings.push({
          rule: 'console',
          enforcement: 'conformance',
          fixture: FIXTURE_NAME,
          viewport,
          message: `${error.kind}: ${error.message}`,
          repair: 'Fix the underlying browser error; a conforming fixture must render without console, page, or request failures.',
        })
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
  return { findings, screenshots }
}

/** Build, inspect, screenshot, and report one deterministic plugin UI fixture. */
export async function runPluginUiConformance(
  options: RunPluginUiConformanceOptions = {},
): Promise<PluginUiConformanceReport> {
  const requestedRoot = resolve(options.cwd ?? process.cwd())
  if (!existsSync(requestedRoot) || !statSync(requestedRoot).isDirectory()) {
    throw new Error(`Plugin package root not found: ${requestedRoot}`)
  }
  const root = realpathSync(requestedRoot)
  const config = await loadConfig(root, options)
  const reportDir = resolveWritableWithin(root, config.reportDir, 'reportDir')
  prepareReportDirectory(reportDir)

  const stageDir = mkdtempSync(join(reportDir, '.fixture-'))
  let findings: PluginUiConformanceFinding[] = []
  let screenshots: PluginUiConformanceScreenshot[] = []
  try {
    const built = await buildFixture(root, config, stageDir)
    findings = stylesheetFindings(root, config, built)

    if (findings.length === 0) {
      const require = createRequire(join(root, 'package.json'))
      copyFileSync(require.resolve(SDK_STYLES_SPECIFIER), join(stageDir, 'sdk-styles.css'))
      writeFileSync(join(stageDir, 'index.html'), buildFixtureHtml(stageDir, built), 'utf8')
      const server = await createFixtureServer(stageDir)
      try {
        const browser = await runBrowserChecks(
          server.url,
          root,
          config,
          reportDir,
          options.browserExecutablePath,
        )
        findings.push(...browser.findings)
        screenshots = browser.screenshots
      } finally {
        await server.stop()
      }
    }
  } finally {
    rmSync(stageDir, { recursive: true, force: true })
  }

  const report: PluginUiConformanceReport = {
    schemaVersion: 1,
    pluginId: config.pluginId,
    generatedAt: new Date().toISOString(),
    status: findings.length === 0 ? 'passed' : 'failed',
    reportDir: config.reportDir,
    findings,
    screenshots,
  }
  writeReport(reportDir, report)
  return report
}
