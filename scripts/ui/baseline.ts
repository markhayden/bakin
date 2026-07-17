#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { performance } from 'node:perf_hooks'
import { chromium, type Browser, type Page } from 'playwright'
import sharp from 'sharp'

import { collectArtifactSizes } from '../report-sizes'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const BITS_ROOT = resolve(REPO_ROOT, '../bakin-bits-official')
const MANIFEST_PATH = join(REPO_ROOT, 'design-system/baseline/manifest.json')
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, 'design-system/baseline/current')

export const REQUIRED_PAGE_ARCHETYPES = [
  'list-index',
  'detail',
  'settings-form',
  'dashboard-overview',
  'conversation',
  'inspector',
  'workflow-action',
] as const

export type PageArchetype = (typeof REQUIRED_PAGE_ARCHETYPES)[number]
export type BaselineOwner = 'core' | 'bits'
export type BaselineViewport = 'desktop' | 'mobile'

export interface BaselineScenario {
  id: string
  archetype: PageArchetype
  owner: BaselineOwner
  route: string
  ready: string
  expectText?: string
  redactSelectors?: string[]
  viewports: readonly BaselineViewport[]
}

export interface BaselineViewportSize {
  width: number
  height: number
}

export interface BaselineManifest {
  schemaVersion: number
  baselineId: string
  fixture: {
    baseUrl: string
    healthPath: string
    command: string[]
    fixedNow: string
    colorScheme: 'dark' | 'light'
    redactSelectors: string[]
  }
  viewports: Record<BaselineViewport, BaselineViewportSize>
  scenarios: BaselineScenario[]
}

export interface CaptureTarget extends BaselineScenario {
  viewportId: BaselineViewport
  viewport: BaselineViewportSize
  outputFile: string
}

export interface SourceFile {
  path: string
  source: string
}

interface StyleViolationReport {
  totals: Record<string, number>
  byPath: Record<string, Record<string, number>>
}

const STYLE_DEBT_RULES = [
  { id: 'arbitrary-value', pattern: /(?:^|[\s"'])(?:-?[a-z]+:)*-?[a-z]+-\[[^\]]+\]/g },
  { id: 'inline-style', pattern: /\bstyle\s*=\s*\{\{/g },
  { id: 'native-control', pattern: /<(?:button|input|select|textarea)\b/g },
  {
    id: 'raw-color',
    pattern: /#[0-9a-fA-F]{3,8}\b|(?:^|[\s"'])(?:[a-z]+:)*(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
  },
] as const

function matchCount(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length
}

export function countStyleViolations(files: readonly SourceFile[]): StyleViolationReport {
  const totals = Object.fromEntries(STYLE_DEBT_RULES.map((rule) => [rule.id, 0]))
  const byPath: Record<string, Record<string, number>> = {}

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const counts: Record<string, number> = {}
    for (const rule of STYLE_DEBT_RULES) {
      const count = matchCount(file.source, rule.pattern)
      if (count === 0) continue
      counts[rule.id] = count
      totals[rule.id] += count
    }
    if (Object.keys(counts).length > 0) byPath[file.path] = counts
  }

  return { totals, byPath }
}

export function validateBaselineScenarios(scenarios: readonly BaselineScenario[]): string[] {
  const errors: string[] = []
  const seenIds = new Set<string>()

  for (const scenario of scenarios) {
    if (seenIds.has(scenario.id)) errors.push(`duplicate scenario id "${scenario.id}"`)
    seenIds.add(scenario.id)

    if (!scenario.route.startsWith('/') || scenario.route.startsWith('//') || scenario.route.includes('://')) {
      errors.push(`scenario "${scenario.id}" route must be a root-relative application path`)
    }
    if (scenario.owner === 'bits' && !scenario.expectText) {
      errors.push(`Bits scenario "${scenario.id}" must declare page-specific expected text`)
    }
  }

  for (const archetype of REQUIRED_PAGE_ARCHETYPES) {
    const matching = scenarios.filter((scenario) => scenario.archetype === archetype)
    for (const viewport of ['desktop', 'mobile'] as const) {
      if (!matching.some((scenario) => scenario.viewports.includes(viewport))) {
        errors.push(`archetype "${archetype}" is missing ${viewport} coverage`)
      }
    }
  }

  if (!scenarios.some((scenario) => scenario.owner === 'bits')) {
    errors.push('at least one official Bits scenario is required')
  }

  return errors
}

export function expandCapturePlan(manifest: BaselineManifest): CaptureTarget[] {
  return manifest.scenarios.flatMap((scenario) => scenario.viewports.map((viewportId) => ({
    ...scenario,
    viewportId,
    viewport: manifest.viewports[viewportId],
    outputFile: `${scenario.id}--${viewportId}.webp`,
  })))
}

export function selectFixtureMode(options: {
  explicitBaseUrl: boolean
  serverReady: boolean
}): 'start' | 'use-existing' {
  if (options.explicitBaseUrl) {
    if (options.serverReady) return 'use-existing'
    throw new Error('Explicit baseline server is not reachable; start it before capturing')
  }
  if (options.serverReady) {
    throw new Error(
      'The default baseline URL already has a healthy server; stop it or pass --base-url to reuse it explicitly',
    )
  }
  return 'start'
}

const UNIX_MACHINE_PATH = /^\/(?:Users|home|private|tmp|var|opt|Volumes)(?:\/|$)/
const WINDOWS_MACHINE_PATH = /^[A-Za-z]:\\/

export function findPortabilityViolations(value: unknown): string[] {
  const violations: string[] = []

  const visit = (current: unknown, keyPath: string): void => {
    if (typeof current === 'string') {
      if (UNIX_MACHINE_PATH.test(current) || WINDOWS_MACHINE_PATH.test(current)) {
        violations.push(`${keyPath} contains an absolute filesystem path`)
      }
      return
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${keyPath}[${index}]`))
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, entry] of Object.entries(current)) {
      visit(entry, keyPath ? `${keyPath}.${key}` : key)
    }
  }

  visit(value, '')
  return violations
}

interface CaptureResult {
  id: string
  archetype: PageArchetype
  owner: BaselineOwner
  route: string
  viewport: BaselineViewport
  outputFile: string
  sha256: string
  bytes: number
  console: { errors: number; warnings: number }
  failedRequests: number
  failedRequestDetails: Array<{
    method: string
    path: string
    resourceType: string
    errorText: string
  }>
  timingMs: {
    ready: number
    responseStart: number | null
    domContentLoaded: number | null
    load: number | null
  }
}

interface BaselineInventory {
  hostRouteFiles: string[]
  corePluginManifests: string[]
  bitsPluginManifests: string[]
}

interface MockServerHandle {
  process: ChildProcess
  fixtureRoot: string
}

const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const IGNORED_SOURCE_DIRS = new Set(['.git', 'dist', 'node_modules'])

function extension(path: string): string {
  const index = path.lastIndexOf('.')
  return index === -1 ? '' : path.slice(index)
}

function walkFiles(root: string, include: (path: string) => boolean): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (IGNORED_SOURCE_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && include(path)) files.push(path)
    }
  }
  visit(root)
  return files
}

function portablePath(root: string, path: string, prefix = ''): string {
  const suffix = relative(root, path).split('\\').join('/')
  return prefix ? `${prefix}/${suffix}` : suffix
}

function collectInventory(): BaselineInventory {
  if (!existsSync(join(BITS_ROOT, 'plugins'))) {
    throw new Error('Official Bits checkout is required at ../bakin-bits-official for the full baseline')
  }

  const hostRouteFiles = walkFiles(
    join(REPO_ROOT, 'packages/host/src/routes'),
    (path) => path.endsWith('.tsx'),
  ).map((path) => portablePath(REPO_ROOT, path))
  const corePluginManifests = walkFiles(
    join(REPO_ROOT, 'plugins'),
    (path) => path.endsWith('/bakin-plugin.json'),
  ).map((path) => portablePath(REPO_ROOT, path))
  const bitsPluginManifests = walkFiles(
    join(BITS_ROOT, 'plugins'),
    (path) => path.endsWith('/bakin-plugin.json'),
  ).map((path) => portablePath(BITS_ROOT, path, 'bakin-bits-official'))

  return { hostRouteFiles, corePluginManifests, bitsPluginManifests }
}

function collectStyleSources(): SourceFile[] {
  const roots = [
    { root: join(REPO_ROOT, 'packages/host/src'), base: REPO_ROOT, prefix: '' },
    { root: join(REPO_ROOT, 'plugins'), base: REPO_ROOT, prefix: '' },
    { root: join(BITS_ROOT, 'plugins'), base: BITS_ROOT, prefix: 'bakin-bits-official' },
  ]

  return roots.flatMap(({ root, base, prefix }) => walkFiles(
    root,
    (path) => SOURCE_EXTENSIONS.has(extension(path)),
  ).map((path) => ({
    path: portablePath(base, path, prefix),
    source: readFileSync(path, 'utf-8'),
  })))
}

function readManifest(): BaselineManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as BaselineManifest
}

function gitRef(repo: string): string {
  return execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim()
}

function playwrightVersion(): string {
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'node_modules/playwright/package.json'), 'utf-8')) as {
    version: string
  }
  return packageJson.version
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function serverIsReady(baseUrl: string, healthPath: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}${healthPath}`, { signal: AbortSignal.timeout(2_000) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(
  baseUrl: string,
  healthPath: string,
  process: ChildProcess,
): Promise<void> {
  for (let attempt = 1; attempt <= 90; attempt++) {
    if (await serverIsReady(baseUrl, healthPath)) return
    if (process.exitCode !== null) throw new Error(`Mock server exited with code ${process.exitCode}`)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Mock server at ${baseUrl} was not ready after 90 seconds`)
}

function findAvailableLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not allocate a private mock gateway port'))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolvePort(address.port)
      })
    })
  })
}

function startMockServer(manifest: BaselineManifest, gatewayPort: number): MockServerHandle {
  const [command, ...args] = manifest.fixture.command
  if (!command) throw new Error('Baseline fixture command is empty')
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'bakin-ui-baseline-fixture-'))
  const mockHome = join(fixtureRoot, 'home')
  const childProcess = spawn(command, args, {
    cwd: REPO_ROOT,
    detached: true,
    env: {
      ...process.env,
      BAKIN_SEED_USAGE: '1',
      BAKIN_SEARCH_SERVICE_MODE: 'child',
      OPENCLAW_MOCK_FORCE: '1',
      IMITATION_CRAB_HOME: mockHome,
      IMITATION_CRAB_PORT: String(gatewayPort),
    },
    stdio: 'inherit',
  })
  return { process: childProcess, fixtureRoot }
}

async function stopMockServer(handle: MockServerHandle): Promise<void> {
  const { process: childProcess, fixtureRoot } = handle
  const signalProcessGroup = (signal: NodeJS.Signals): void => {
    if (!childProcess.pid) return
    try {
      if (platform() === 'win32') childProcess.kill(signal)
      else process.kill(-childProcess.pid, signal)
    } catch {
      try {
        childProcess.kill(signal)
      } catch {
        // The fixture may already have exited after a failed capture.
      }
    }
  }

  if (childProcess.pid && childProcess.exitCode === null) {
    signalProcessGroup('SIGTERM')
    await Promise.race([
      new Promise<void>((resolve) => childProcess.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ])
    if (childProcess.exitCode === null) {
      signalProcessGroup('SIGKILL')
      await Promise.race([
        new Promise<void>((resolve) => childProcess.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ])
    }
  }
  rmSync(fixtureRoot, { recursive: true, force: true })
}

async function settlePage(page: Page, target: CaptureTarget): Promise<void> {
  await page.locator(target.ready).first().waitFor({ state: 'visible', timeout: 20_000 })
  if (await page.getByText('Page not found', { exact: true }).isVisible()) {
    throw new Error(`${target.route} rendered the host route fallback`)
  }
  if (target.expectText) {
    await page.locator('main').getByText(target.expectText, { exact: true }).first().waitFor({
      state: 'visible',
      timeout: 20_000,
    })
  }
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForTimeout(1_000)
  await page.addStyleTag({
    content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}',
  })
}

async function redactNondeterministicContent(
  page: Page,
  manifest: BaselineManifest,
  target: CaptureTarget,
): Promise<void> {
  for (const selector of [...manifest.fixture.redactSelectors, ...(target.redactSelectors ?? [])]) {
    await page.locator(selector).evaluateAll((elements) => {
      for (const element of elements) {
        if (element instanceof HTMLElement) element.style.visibility = 'hidden'
      }
    })
  }
}

async function captureTarget(
  browser: Browser,
  manifest: BaselineManifest,
  target: CaptureTarget,
  baseUrl: string,
  screenshotsDir: string,
): Promise<CaptureResult> {
  const context = await browser.newContext({
    viewport: target.viewport,
    colorScheme: manifest.fixture.colorScheme,
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  })
  await context.addInitScript((fixedNow) => {
    const NativeDate = Date
    const fixedTime = NativeDate.parse(fixedNow)
    function StableDate(...args: unknown[]) {
      if (!new.target) return new NativeDate(fixedTime).toString()
      return Reflect.construct(NativeDate, args.length > 0 ? args : [fixedTime], new.target)
    }
    Object.setPrototypeOf(StableDate, NativeDate)
    StableDate.prototype = NativeDate.prototype
    Object.defineProperty(StableDate, 'now', { value: () => fixedTime })
    Object.defineProperty(globalThis, 'Date', { value: StableDate })
    localStorage.setItem('bakin-activity-log-open', 'false')
    localStorage.setItem('sidebar-collapsed', 'false')
  }, manifest.fixture.fixedNow)

  const page = await context.newPage()
  let consoleErrors = 0
  let consoleWarnings = 0
  let failedRequests = 0
  const failedRequestDetails: CaptureResult['failedRequestDetails'] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors++
    if (message.type() === 'warning') consoleWarnings++
  })
  page.on('requestfailed', (request) => {
    failedRequests++
    const url = new URL(request.url())
    failedRequestDetails.push({
      method: request.method(),
      path: `${url.pathname}${url.search}`,
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText ?? 'unknown',
    })
  })

  const pngPath = join(screenshotsDir, target.outputFile.replace(/\.webp$/, '.png'))
  const webpPath = join(screenshotsDir, target.outputFile)
  const started = performance.now()

  try {
    await page.goto(`${baseUrl}${target.route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await settlePage(page, target)
    await redactNondeterministicContent(page, manifest, target)
    const ready = Math.round(performance.now() - started)
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntries().find(
        (candidate) => 'domContentLoadedEventEnd' in candidate,
      ) as PerformanceNavigationTiming | undefined
      if (!entry) return null
      return {
        responseStart: entry.responseStart,
        domContentLoaded: entry.domContentLoadedEventEnd,
        load: entry.loadEventEnd,
      }
    })

    await page.screenshot({
      path: pngPath,
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
    })
    await sharp(pngPath).webp({ lossless: true }).toFile(webpPath)
    rmSync(pngPath, { force: true })

    return {
      id: target.id,
      archetype: target.archetype,
      owner: target.owner,
      route: target.route,
      viewport: target.viewportId,
      outputFile: `screenshots/${target.outputFile}`,
      sha256: sha256(webpPath),
      bytes: statSync(webpPath).size,
      console: { errors: consoleErrors, warnings: consoleWarnings },
      failedRequests,
      failedRequestDetails,
      timingMs: {
        ready,
        responseStart: navigation ? Math.round(navigation.responseStart) : null,
        domContentLoaded: navigation ? Math.round(navigation.domContentLoaded) : null,
        load: navigation ? Math.round(navigation.load) : null,
      },
    }
  } finally {
    rmSync(pngPath, { force: true })
    await context.close()
  }
}

function buildReport(
  manifest: BaselineManifest,
  inventory: BaselineInventory,
  captures: CaptureResult[],
  browserVersion: string,
): Record<string, unknown> {
  const styleSources = collectStyleSources()
  return {
    schemaVersion: 1,
    baselineId: manifest.baselineId,
    refs: {
      bakin: gitRef(REPO_ROOT),
      bits: gitRef(BITS_ROOT),
    },
    commands: [
      'bun run build:host',
      'bun run build:plugins',
      'bun run build:assets-manifest',
      'bun run ui:baseline:capture',
      'bun run ui:baseline:check',
    ],
    environment: {
      platform: platform(),
      architecture: arch(),
      bun: process.versions.bun ?? 'unknown',
      playwright: playwrightVersion(),
      chromium: browserVersion,
      colorScheme: manifest.fixture.colorScheme,
      fixedNow: manifest.fixture.fixedNow,
      viewports: manifest.viewports,
    },
    counts: {
      scenarios: manifest.scenarios.length,
      captures: captures.length,
      hostRouteFiles: inventory.hostRouteFiles.length,
      corePluginManifests: inventory.corePluginManifests.length,
      bitsPluginManifests: inventory.bitsPluginManifests.length,
      styleSourceFiles: styleSources.length,
    },
    inventory,
    styleViolations: countStyleViolations(styleSources),
    artifactSizes: collectArtifactSizes(REPO_ROOT),
    captures,
    outputLocations: ['report.json', 'screenshots/'],
  }
}

async function captureBaseline(
  manifest: BaselineManifest,
  baseUrl: string,
  outputDir: string,
  explicitBaseUrl: boolean,
): Promise<void> {
  const errors = validateBaselineScenarios(manifest.scenarios)
  if (errors.length > 0) throw new Error(`Invalid baseline manifest:\n- ${errors.join('\n- ')}`)
  const plan = expandCapturePlan(manifest)
  const inventory = collectInventory()
  const fixtureMode = selectFixtureMode({
    explicitBaseUrl,
    serverReady: await serverIsReady(baseUrl, manifest.fixture.healthPath),
  })

  mkdirSync(outputDir, { recursive: true })
  const stagingDir = mkdtempSync(join(outputDir, '.capture-'))
  const screenshotsDir = join(stagingDir, 'screenshots')
  mkdirSync(screenshotsDir, { recursive: true })

  let mockServer: MockServerHandle | null = null
  let browser: Browser | null = null
  const captures: CaptureResult[] = []
  try {
    if (fixtureMode === 'start') {
      console.log(`Starting ${manifest.fixture.command.join(' ')}...`)
      mockServer = startMockServer(manifest, await findAvailableLoopbackPort())
      await waitForServer(baseUrl, manifest.fixture.healthPath, mockServer.process)
    } else {
      console.log(`Using explicitly configured fixture server at ${baseUrl}`)
    }

    browser = await chromium.launch({ headless: true })
    for (const target of plan) {
      const result = await captureTarget(browser, manifest, target, baseUrl, screenshotsDir)
      captures.push(result)
      console.log(`captured ${target.id} (${target.viewportId})`)
    }

    const report = buildReport(manifest, inventory, captures, browser.version())
    const portabilityErrors = findPortabilityViolations(report)
    if (portabilityErrors.length > 0) {
      throw new Error(`Baseline report is not portable:\n- ${portabilityErrors.join('\n- ')}`)
    }
    writeFileSync(join(stagingDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

    rmSync(join(outputDir, 'screenshots'), { recursive: true, force: true })
    renameSync(screenshotsDir, join(outputDir, 'screenshots'))
    rmSync(join(outputDir, 'report.json'), { force: true })
    renameSync(join(stagingDir, 'report.json'), join(outputDir, 'report.json'))
  } finally {
    if (browser) await browser.close()
    if (mockServer) await stopMockServer(mockServer)
    rmSync(stagingDir, { recursive: true, force: true })
  }
}

function checkBaseline(manifest: BaselineManifest, outputDir: string): void {
  const reportPath = join(outputDir, 'report.json')
  if (!existsSync(reportPath)) throw new Error(`Missing baseline report: ${relative(REPO_ROOT, reportPath)}`)
  const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as {
    captures?: CaptureResult[]
  }
  const portabilityErrors = findPortabilityViolations(report)
  if (portabilityErrors.length > 0) {
    throw new Error(`Baseline report is not portable:\n- ${portabilityErrors.join('\n- ')}`)
  }

  const expected = expandCapturePlan(manifest)
  if (report.captures?.length !== expected.length) {
    throw new Error(`Expected ${expected.length} capture records, found ${report.captures?.length ?? 0}`)
  }
  for (const target of expected) {
    const path = join(outputDir, 'screenshots', target.outputFile)
    const capture = report.captures.find((entry) => entry.outputFile === `screenshots/${target.outputFile}`)
    if (!existsSync(path)) throw new Error(`Missing baseline screenshot: ${target.outputFile}`)
    if (!capture || capture.sha256 !== sha256(path)) {
      throw new Error(`Baseline screenshot hash does not match report: ${target.outputFile}`)
    }
  }
  console.log(`Baseline valid: ${expected.length} captures and portable report metadata`)
}

function parseArgs(): { command: 'capture' | 'check'; baseUrl?: string; outputDir: string } {
  const args = process.argv.slice(2)
  const command = args.shift()
  if (command !== 'capture' && command !== 'check') {
    throw new Error('Usage: bun run scripts/ui/baseline.ts <capture|check> [--base-url URL] [--output-dir PATH]')
  }
  let baseUrl: string | undefined
  let outputDir = DEFAULT_OUTPUT_DIR
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--base-url' && args[index + 1]) baseUrl = args[++index]
    else if (args[index] === '--output-dir' && args[index + 1]) outputDir = resolve(REPO_ROOT, args[++index])
    else throw new Error(`Unknown baseline argument: ${args[index]}`)
  }
  return { command, baseUrl, outputDir }
}

async function main(): Promise<void> {
  const manifest = readManifest()
  const options = parseArgs()
  if (options.command === 'capture') {
    const configuredBaseUrl = options.baseUrl ?? process.env.BAKIN_BASELINE_BASE_URL
    await captureBaseline(
      manifest,
      configuredBaseUrl ?? manifest.fixture.baseUrl,
      options.outputDir,
      configuredBaseUrl !== undefined,
    )
  } else {
    checkBaseline(manifest, options.outputDir)
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
