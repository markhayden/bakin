#!/usr/bin/env bun

/**
 * Repeatable real-browser gate for the action-first Health dashboard.
 *
 * The verifier expects an already-running Bakin instance so the same command
 * works against `dev:mock`, a local development server, or a packaged build.
 * Artifacts default to the OS temp directory and therefore never dirty the
 * repository.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from 'playwright'

const HEALTH_PATH = '/health'
const PREFLIGHT_PATH = '/api/plugins/health/summary'
const ACTIVITY_OPEN_KEY = 'bakin-activity-log-open'
const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed'
const DESKTOP_SHELL_WIDTH = 208 + 360
const DEFAULT_POLL_GATE_MS = 61_500
const TAB_SETTLE_MS = 700
const CONTAINER_TARGETS = [1_024, 720, 480, 320] as const
const PHONE_VIEWPORTS = [480, 320] as const
const TABS = ['Overview', 'Agents', 'Activity', 'System'] as const

type TabName = typeof TABS[number]
type ResultKind = 'pass' | 'fail' | 'skip' | 'known-limit'

interface Options {
  baseUrl: string
  outputDir: string
  headed: boolean
  quick: boolean
  screenshots: boolean
}

interface GateResult {
  kind: ResultKind
  name: string
  detail: string
}

interface RequestRecord {
  phase: string
  method: string
  url: string
  path: string
}

interface HttpFailure {
  phase: string
  status: number
  method: string
  url: string
}

interface TransportFailure {
  phase: string
  method: string
  url: string
  reason: string
}

interface ConsoleRecord {
  phase: string
  type: string
  text: string
  location: string | null
}

interface UsageFeedPayload {
  phase: string
  url: string
  body: unknown
}

interface Telemetry {
  requests: RequestRecord[]
  httpFailures: HttpFailure[]
  transportFailures: TransportFailure[]
  console: ConsoleRecord[]
  pageErrors: Array<{ phase: string; message: string }>
  usageFeeds: UsageFeedPayload[]
}

interface PhaseRef {
  current: string
}

interface LayoutMetrics {
  viewportWidth: number
  healthWidth: number
  healthClientWidth: number
  healthScrollWidth: number
  documentClientWidth: number
  documentScrollWidth: number
  tablistClientWidth: number | null
  tablistScrollWidth: number | null
  tablistOverflowX: string | null
  activityPanelWidth: number | null
  internalTables: Array<{
    testId: string
    clientWidth: number
    scrollWidth: number
    overflowX: string
  }>
}

const TAB_HEADINGS: Record<TabName, readonly string[]> = {
  Overview: ['Overall health', 'Search readiness', 'Right now'],
  Agents: ['Agents', 'Agent token trend', 'Usage & efficiency', 'Latest session token usage'],
  Activity: ['Activity', 'Failure trend', 'Failures'],
  System: ['System', 'Subsystem status', 'Search', 'Installed plugins', 'Runtime', 'Full check inventory'],
}

/** Endpoints unique enough to prove that an inactive tab was not mounted. */
const TAB_REQUEST_PATHS: Record<TabName, readonly string[]> = {
  Overview: [
    '/api/plugins/health/live-now',
    '/api/plugins/health/search-readiness',
  ],
  Agents: [
    '/api/plugins/health/usage-history',
    '/api/plugins/health/agent-effort',
    '/api/plugins/health/usage',
    '/api/plugins/models/spend',
  ],
  Activity: ['/api/plugins/health/usage-feed'],
  System: [
    '/api/plugins/health/search-status',
    '/api/plugins/health/search-telemetry',
    '/api/plugins/health/registry',
  ],
}

class Gate {
  readonly results: GateResult[] = []

  record(kind: ResultKind, name: string, detail: string): void {
    this.results.push({ kind, name, detail })
    const marker = kind === 'pass' ? 'PASS'
      : kind === 'fail' ? 'FAIL'
        : kind === 'known-limit' ? 'KNOWN LIMIT'
          : 'SKIP'
    const color = kind === 'pass' ? '\x1b[32m'
      : kind === 'fail' ? '\x1b[31m'
        : kind === 'known-limit' ? '\x1b[33m'
          : '\x1b[36m'
    console.log(`  ${color}${marker}\x1b[0m  ${name} — ${detail}`)
  }

  check(name: string, condition: boolean, detail: string): boolean {
    this.record(condition ? 'pass' : 'fail', name, detail)
    return condition
  }

  pass(name: string, detail: string): void {
    this.record('pass', name, detail)
  }

  fail(name: string, detail: string): void {
    this.record('fail', name, detail)
  }

  skip(name: string, detail: string): void {
    this.record('skip', name, detail)
  }

  known(name: string, detail: string): void {
    this.record('known-limit', name, detail)
  }

  get failures(): GateResult[] {
    return this.results.filter((result) => result.kind === 'fail')
  }
}

function usage(exitCode = 2): never {
  console.error('Usage: bun run verify:health-ui --base-url http://127.0.0.1:3737 [--headed] [--quick] [--no-screenshots] [--output-dir <path>]')
  process.exit(exitCode)
}

function parseArgs(argv: string[]): Options {
  let baseUrl = process.env.BAKIN_URL ?? 'http://127.0.0.1:3737'
  let outputDir = join(tmpdir(), `bakin-health-ui-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  let headed = false
  let quick = false
  let screenshots = true

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--base-url') {
      const value = argv[++index]
      if (!value) usage()
      baseUrl = value
    } else if (arg === '--output-dir') {
      const value = argv[++index]
      if (!value) usage()
      outputDir = isAbsolute(value) ? value : resolve(process.cwd(), value)
    } else if (arg === '--headed') {
      headed = true
    } else if (arg === '--quick') {
      quick = true
    } else if (arg === '--no-screenshots') {
      screenshots = false
    } else if (arg === '--help' || arg === '-h') {
      usage(0)
    } else {
      console.error(`Unknown option: ${arg}`)
      usage()
    }
  }

  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`Invalid --base-url: ${baseUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--base-url must use http or https')
  }

  return {
    baseUrl: parsed.href.replace(/\/$/, ''),
    outputDir,
    headed,
    quick,
    screenshots,
  }
}

function emptyTelemetry(): Telemetry {
  return {
    requests: [],
    httpFailures: [],
    transportFailures: [],
    console: [],
    pageErrors: [],
    usageFeeds: [],
  }
}

function requestPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function locationLabel(message: ConsoleMessage): string | null {
  const location = message.location()
  if (!location.url) return null
  return `${location.url}${location.lineNumber ? `:${location.lineNumber}` : ''}`
}

function expectedCancellation(failure: TransportFailure): boolean {
  return /ERR_ABORTED|NS_BINDING_ABORTED|aborted/i.test(failure.reason)
}

function expectedConsoleNoise(entry: ConsoleRecord): boolean {
  return entry.type === 'warning'
    && entry.text.includes('[bakin-dev] EventSource error — will auto-reconnect')
}

function attachTelemetry(page: Page, phase: PhaseRef, telemetry: Telemetry, baseOrigin: string): void {
  const requestPhases = new WeakMap<Request, string>()
  page.on('request', (request: Request) => {
    requestPhases.set(request, phase.current)
    telemetry.requests.push({
      phase: phase.current,
      method: request.method(),
      url: request.url(),
      path: requestPath(request.url()),
    })
  })

  page.on('response', (response: Response) => {
    const request = response.request()
    const requestPhase = requestPhases.get(request) ?? phase.current
    let origin: string | null = null
    try { origin = new URL(response.url()).origin } catch { /* malformed browser URL */ }
    if (origin === baseOrigin && response.status() >= 400) {
      telemetry.httpFailures.push({
        phase: requestPhase,
        status: response.status(),
        method: request.method(),
        url: response.url(),
      })
    }
    if (requestPath(response.url()) === '/api/plugins/health/usage-feed' && response.ok()) {
      void response.json()
        .then((body: unknown) => telemetry.usageFeeds.push({ phase: requestPhase, url: response.url(), body }))
        .catch(() => {})
    }
  })

  page.on('requestfailed', (request: Request) => {
    telemetry.transportFailures.push({
      phase: requestPhases.get(request) ?? phase.current,
      method: request.method(),
      url: request.url(),
      reason: request.failure()?.errorText ?? 'unknown transport failure',
    })
  })

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return
    telemetry.console.push({
      phase: phase.current,
      type: message.type(),
      text: message.text(),
      location: locationLabel(message),
    })
  })

  page.on('pageerror', (error: Error) => {
    telemetry.pageErrors.push({ phase: phase.current, message: error.message })
  })
}

async function configureShell(context: BrowserContext, activityOpen: boolean): Promise<void> {
  await context.addInitScript(({ activityKey, sidebarKey, activityOpen: open }) => {
    localStorage.setItem(activityKey, String(open))
    localStorage.setItem(sidebarKey, 'false')
  }, { activityKey: ACTIVITY_OPEN_KEY, sidebarKey: SIDEBAR_COLLAPSED_KEY, activityOpen })
}

async function newObservedPage(
  context: BrowserContext,
  phase: PhaseRef,
  telemetry: Telemetry,
  baseOrigin: string,
): Promise<Page> {
  const page = await context.newPage()
  attachTelemetry(page, phase, telemetry, baseOrigin)
  return page
}

async function waitForHealth(page: Page): Promise<void> {
  await page.locator('.health-page').waitFor({ state: 'visible', timeout: 20_000 })
  await page.getByRole('tablist').waitFor({ state: 'visible', timeout: 10_000 })
}

async function navigateHealth(page: Page, baseUrl: string, tab: TabName): Promise<void> {
  await page.goto(`${baseUrl}${HEALTH_PATH}?tab=${tab.toLowerCase()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await waitForHealth(page)
  await waitForTabContent(page, tab)
}

function pathMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.startsWith(`${expected}/`)
}

function phaseRequests(telemetry: Telemetry, phase: string): RequestRecord[] {
  return telemetry.requests.filter((request) => request.phase === phase)
}

function requestMatchesTab(request: RequestRecord, tab: TabName): boolean {
  return TAB_REQUEST_PATHS[tab].some((expected) => pathMatches(request.path, expected))
}

async function waitForTabContent(page: Page, tab: TabName): Promise<void> {
  await page.getByRole('tab', { name: tab, exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForFunction((name) => {
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    return tabs.some((candidate) => candidate.textContent?.trim() === name && candidate.getAttribute('aria-selected') === 'true')
  }, tab, { timeout: 10_000 })
  await page.getByRole('heading', { name: TAB_HEADINGS[tab][0], exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
  if (tab === 'Agents') {
    const panel = page.locator('[role="tabpanel"]:visible')
    await panel.locator('[data-testid="latest-session-usage"], [role="alert"]').first()
      .waitFor({ state: 'visible', timeout: 20_000 })
  }
  await page.waitForTimeout(TAB_SETTLE_MS)
}

async function verifyTabStructure(page: Page, tab: TabName, gate: Gate, scope: string): Promise<void> {
  const tabLocator = page.getByRole('tab', { name: tab, exact: true })
  const selected = await tabLocator.getAttribute('aria-selected')
  const controls = await tabLocator.getAttribute('aria-controls')
  const tabId = await tabLocator.getAttribute('id')
  const panel = page.locator('[role="tabpanel"]:visible').first()
  const panelCount = await page.locator('[role="tabpanel"]:visible').count()
  const panelId = panelCount > 0 ? await panel.getAttribute('id') : null
  const labelledBy = panelCount > 0 ? await panel.getAttribute('aria-labelledby') : null

  gate.check(`${scope}: ${tab} tab selected`, selected === 'true', `aria-selected=${selected ?? 'missing'}`)
  gate.check(`${scope}: one visible tabpanel`, panelCount === 1, `${panelCount} visible tabpanels`)
  gate.check(
    `${scope}: ${tab} ARIA relationship`,
    Boolean(controls && tabId && controls === panelId && labelledBy === tabId),
    `tab controls=${controls ?? 'missing'}, panel id=${panelId ?? 'missing'}, labelledby=${labelledBy ?? 'missing'}`,
  )

  for (const label of TAB_HEADINGS[tab]) {
    const name = label === 'Failures' ? /^Failures \(\d+\)$/ : label
    const locator = page.getByRole('heading', { name, exact: label !== 'Failures' })
    const count = await locator.count()
    gate.check(
      `${scope}: ${tab} shows ${label}`,
      count > 0,
      count > 0 ? 'heading visible' : 'heading missing',
    )
  }

  const actualTab = new URL(page.url()).searchParams.get('tab')
  gate.check(`${scope}: ${tab} URL state`, actualTab === tab.toLowerCase(), `tab=${actualTab ?? 'missing'}`)
}

async function activateNextTabWithKeyboard(
  page: Page,
  current: TabName,
  next: TabName,
  phase: PhaseRef,
  telemetry: Telemetry,
  gate: Gate,
): Promise<void> {
  await page.getByRole('tab', { name: current, exact: true }).focus()
  await page.waitForTimeout(200)
  phase.current = `keyboard-${next.toLowerCase()}`
  await page.keyboard.press('ArrowRight')
  await waitForTabContent(page, next)
  await verifyTabStructure(page, next, gate, 'keyboard')

  const requests = phaseRequests(telemetry, phase.current)
  const activeRequests = requests.filter((request) => requestMatchesTab(request, next))
  gate.check(
    `keyboard: ${next} mounted its data source`,
    activeRequests.length > 0,
    activeRequests.length > 0
      ? activeRequests.map((request) => request.path).join(', ')
      : `no ${next}-specific request observed`,
  )
  const foreign = TABS
    .filter((tab) => tab !== next)
    .flatMap((tab) => requests.filter((request) => requestMatchesTab(request, tab)).map((request) => `${tab}:${request.path}`))
  gate.check(
    `keyboard: inactive tabs stayed unmounted on ${next}`,
    foreign.length === 0,
    foreign.length === 0 ? 'no foreign tab-specific requests' : foreign.join(', '),
  )
}

async function capture(page: Page, options: Options, name: string): Promise<string | null> {
  if (!options.screenshots) return null
  const path = join(options.outputDir, `${name}.png`)
  await page.screenshot({ path, fullPage: false, animations: 'disabled' })
  return path
}

async function captureTop(page: Page, options: Options, name: string): Promise<string | null> {
  const header = page.getByRole('heading', { level: 1, name: 'Health', exact: true })
  if (await header.count()) await header.scrollIntoViewIfNeeded()
  return await capture(page, options, name)
}

async function exerciseEvidence(page: Page, gate: Gate, options: Options, prefix: string): Promise<boolean> {
  const summary = page.locator('summary').filter({ hasText: 'Technical evidence' }).first()
  if (await summary.count() === 0) {
    gate.skip(`${prefix}: incident evidence`, 'no active incident exists in this fixture')
    return false
  }
  await summary.scrollIntoViewIfNeeded()
  await summary.focus()
  await page.keyboard.press('Enter')
  const details = summary.locator('xpath=..')
  const open = await details.evaluate((element) => (element as HTMLDetailsElement).open)
  gate.check(`${prefix}: incident evidence keyboard disclosure`, open, `details.open=${open}`)
  await capture(page, options, `${prefix}-evidence-open`)
  await page.keyboard.press('Enter')
  return true
}

async function exerciseActivityDisclosure(page: Page, gate: Gate, prefix: string): Promise<boolean> {
  const summary = page.locator('summary').filter({ hasText: 'Technical details' }).first()
  if (await summary.count() === 0) {
    gate.skip(`${prefix}: activity disclosure`, 'no activity row exists in this fixture')
    return false
  }
  await summary.focus()
  await page.keyboard.press('Enter')
  const details = summary.locator('xpath=..')
  const open = await details.evaluate((element) => (element as HTMLDetailsElement).open)
  gate.check(`${prefix}: activity disclosure keyboard access`, open, `details.open=${open}`)
  await page.keyboard.press('Enter')
  return true
}

async function exerciseRepairDialog(page: Page, gate: Gate, options: Options, prefix: string): Promise<boolean> {
  const trigger = page.getByRole('button', { name: /Review repair|Repair/i }).first()
  if (await trigger.count() === 0) {
    gate.skip(`${prefix}: repair dialog`, 'healthy fixture has no visible repair trigger')
    return false
  }
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const dialog = page.getByRole('dialog').first()
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  const focusInside = await dialog.evaluate((element) => element.contains(document.activeElement))
  gate.check(`${prefix}: repair dialog traps focus`, focusInside, `focus inside dialog=${focusInside}`)
  await page.getByText(/Planning against the current evidence/).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {})
  await capture(page, options, `${prefix}-repair-plan`)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
  const restored = await trigger.evaluate((element) => document.activeElement === element)
  gate.check(`${prefix}: repair dialog restores focus`, restored, `focus restored=${restored}`)
  return true
}

async function layoutMetrics(page: Page): Promise<LayoutMetrics> {
  return await page.evaluate(() => {
    const health = document.querySelector<HTMLElement>('.health-page')
    if (!health) throw new Error('.health-page was not found')
    const tablist = document.querySelector<HTMLElement>('[role="tablist"]')
    const tabScroller = tablist?.parentElement
    const activityPanel = document.querySelector('main')?.nextElementSibling as HTMLElement | null
    const internalTables = [...health.querySelectorAll<HTMLElement>('[data-testid$="-table-scroll"]')]
      .map((element) => ({
        testId: element.dataset.testid ?? 'unnamed-table-scroll',
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
      }))
    return {
      viewportWidth: window.innerWidth,
      healthWidth: health.getBoundingClientRect().width,
      healthClientWidth: health.clientWidth,
      healthScrollWidth: health.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      tablistClientWidth: tabScroller?.clientWidth ?? null,
      tablistScrollWidth: tabScroller?.scrollWidth ?? null,
      tablistOverflowX: tabScroller ? getComputedStyle(tabScroller).overflowX : null,
      activityPanelWidth: activityPanel?.getBoundingClientRect().width ?? null,
      internalTables,
    }
  })
}

function verifyLayoutMetrics(
  gate: Gate,
  metrics: LayoutMetrics,
  scope: string,
  allowKnownShellOverflow: boolean,
): void {
  if (allowKnownShellOverflow) {
    gate.known(
      `${scope}: fixed activity-panel shell`,
      `viewport ${metrics.viewportWidth}px leaves Health ${Math.round(metrics.healthWidth)}px while the global panel remains 360px; shell redesign is out of scope`,
    )
    return
  }

  gate.check(
    `${scope}: document has no horizontal overflow`,
    metrics.documentScrollWidth <= metrics.documentClientWidth + 2,
    `${metrics.documentScrollWidth}px scroll / ${metrics.documentClientWidth}px client`,
  )
  gate.check(
    `${scope}: Health container contains its children`,
    metrics.healthScrollWidth <= metrics.healthClientWidth + 2,
    `${metrics.healthScrollWidth}px scroll / ${metrics.healthClientWidth}px client`,
  )
  const tabsContained = metrics.tablistClientWidth === null
    || metrics.tablistScrollWidth === null
    || metrics.tablistScrollWidth <= metrics.tablistClientWidth + 2
    || metrics.tablistOverflowX === 'auto'
    || metrics.tablistOverflowX === 'scroll'
  gate.check(
    `${scope}: tabs remain reachable`,
    tabsContained,
    metrics.tablistClientWidth === null
      ? 'tablist missing'
      : `${metrics.tablistScrollWidth}px scroll / ${metrics.tablistClientWidth}px client, overflow-x=${metrics.tablistOverflowX}`,
  )
}

function verifyInternalTables(gate: Gate, metrics: LayoutMetrics, scope: string): void {
  gate.check(
    `${scope}: System raw tables are present`,
    metrics.internalTables.length >= 2,
    `${metrics.internalTables.length} bounded table scrollers`,
  )
  for (const table of metrics.internalTables) {
    const bounded = table.overflowX === 'auto' || table.overflowX === 'scroll'
    gate.check(
      `${scope}: ${table.testId} scrolls internally`,
      bounded,
      `${table.scrollWidth}px scroll / ${table.clientWidth}px client, overflow-x=${table.overflowX}`,
    )
  }
}

async function verifyResponsiveState(
  browser: Browser,
  options: Options,
  gate: Gate,
  telemetry: Telemetry,
  config: {
    label: string
    viewportWidth: number
    activityOpen: boolean
    expectedHealthWidth?: number
    knownShellLimit?: boolean
  },
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: config.viewportWidth, height: 900 },
    colorScheme: 'dark',
  })
  await configureShell(context, config.activityOpen)
  const phase: PhaseRef = { current: `${config.label}-overview` }
  const page = await newObservedPage(context, phase, telemetry, new URL(options.baseUrl).origin)
  try {
    await navigateHealth(page, options.baseUrl, 'Overview')
    let metrics = await layoutMetrics(page)
    const panelStateCorrect = config.activityOpen
      ? (metrics.activityPanelWidth ?? 0) >= 350
      : (metrics.activityPanelWidth ?? Number.POSITIVE_INFINITY) <= 2
    gate.check(
      `${config.label}: global activity panel is ${config.activityOpen ? 'open' : 'hidden'}`,
      panelStateCorrect,
      `measured panel width ${metrics.activityPanelWidth === null ? 'missing' : `${Math.round(metrics.activityPanelWidth)}px`}`,
    )
    if (config.expectedHealthWidth !== undefined) {
      const delta = Math.abs(metrics.healthWidth - config.expectedHealthWidth)
      gate.check(
        `${config.label}: target Health container width`,
        delta <= 32,
        `target ${config.expectedHealthWidth}px, measured ${Math.round(metrics.healthWidth)}px in ${config.viewportWidth}px viewport`,
      )
    }
    verifyLayoutMetrics(gate, metrics, `${config.label}: Overview`, config.knownShellLimit === true)
    await captureTop(page, options, `${config.label}-overview`)
    if (config.knownShellLimit) return
    await exerciseEvidence(page, gate, options, config.label)
    await exerciseRepairDialog(page, gate, options, config.label)

    for (const tab of ['Agents', 'Activity', 'System'] as const) {
      phase.current = `${config.label}-${tab.toLowerCase()}`
      try {
        await page.getByRole('tab', { name: tab, exact: true }).click()
        await waitForTabContent(page, tab)
        metrics = await layoutMetrics(page)
        verifyLayoutMetrics(gate, metrics, `${config.label}: ${tab}`, false)
        await captureTop(page, options, `${config.label}-${tab.toLowerCase()}`)
        if (tab === 'System') {
          verifyInternalTables(gate, metrics, `${config.label}: System`)
          const inventory = page.getByRole('heading', { name: 'Full check inventory', exact: true })
          await inventory.scrollIntoViewIfNeeded()
          await capture(page, options, `${config.label}-system-inventory`)
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        gate.fail(`${config.label}: ${tab} inspection`, detail)
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (config.knownShellLimit) {
      gate.known(`${config.label}: full-app inspection`, `${detail}; this is the documented fixed-panel phone-shell limitation`)
      await capture(page, options, `${config.label}-known-shell-limit`).catch(() => null)
    } else {
      throw error
    }
  } finally {
    await context.close()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function verifyActivityNoise(gate: Gate, telemetry: Telemetry): void {
  const payload = [...telemetry.usageFeeds].reverse().find((entry) => entry.phase.includes('activity'))
  if (!payload || !isRecord(payload.body) || !Array.isArray(payload.body.recent)) {
    gate.fail('Activity request trace hides routine success', 'no valid Activity feed payload was captured')
    return
  }
  const routineSuccess = payload.body.recent.filter((entry) => isRecord(entry)
    && entry.activityClass === 'routine'
    && entry.status === 'ok')
  gate.check(
    'Activity request trace hides routine success',
    routineSuccess.length === 0,
    routineSuccess.length === 0 ? 'zero successful routine rows in the default feed' : `${routineSuccess.length} successful routine rows leaked`,
  )
  const healthSuccess = payload.body.recent.filter((entry) => isRecord(entry)
    && entry.status === 'ok'
    && entry.activityClass === 'routine'
    && typeof entry.name === 'string'
    && entry.name.includes('health'))
  gate.check(
    'Health does not lead its own Activity noise',
    healthSuccess.length === 0,
    healthSuccess.length === 0 ? 'no successful routine Health reads in Activity' : `${healthSuccess.length} Health reads leaked`,
  )
}

async function waitWithProgress(ms: number, label: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < ms) {
    const remaining = ms - (Date.now() - startedAt)
    const step = Math.min(10_000, remaining)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, step))
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1_000)
    console.log(`    … ${label}: ${elapsedSeconds}s`)
  }
}

async function verifyPollingIsolation(
  page: Page,
  phase: PhaseRef,
  telemetry: Telemetry,
  gate: Gate,
  quick: boolean,
): Promise<void> {
  if (quick) {
    gate.skip('60-second off-tab polling gate', '--quick was supplied; initial-mount isolation still ran')
    return
  }

  await page.getByRole('tab', { name: 'Overview', exact: true }).click()
  await waitForTabContent(page, 'Overview')
  phase.current = 'poll-isolation-overview'
  await waitWithProgress(DEFAULT_POLL_GATE_MS, 'Overview active / other tabs unmounted')
  const overviewWindow = phaseRequests(telemetry, phase.current)
  const foreign = (['Agents', 'Activity', 'System'] as const)
    .flatMap((tab) => overviewWindow.filter((request) => requestMatchesTab(request, tab)).map((request) => `${tab}:${request.path}`))
  const active = overviewWindow.filter((request) => requestMatchesTab(request, 'Overview'))
  gate.check(
    '60-second off-tab polling gate',
    foreign.length === 0 && active.length > 0,
    foreign.length > 0
      ? `inactive requests: ${foreign.join(', ')}`
      : `${active.length} Overview polls; zero Agents/Activity/System-specific polls`,
  )

  await page.getByRole('tab', { name: 'Activity', exact: true }).click()
  await waitForTabContent(page, 'Activity')
  phase.current = 'poll-isolation-activity'
  await waitWithProgress(16_500, 'Activity active / Overview unmounted')
  const activityWindow = phaseRequests(telemetry, phase.current)
  const overviewLeaks = activityWindow.filter((request) => requestMatchesTab(request, 'Overview'))
  const activityPolls = activityWindow.filter((request) => requestMatchesTab(request, 'Activity'))
  gate.check(
    '15-second Activity polling gate',
    overviewLeaks.length === 0 && activityPolls.length > 0,
    overviewLeaks.length > 0
      ? `Overview leaked: ${overviewLeaks.map((request) => request.path).join(', ')}`
      : `${activityPolls.length} Activity polls; zero Overview-specific polls`,
  )
}

async function verifyReducedMotion(
  browser: Browser,
  options: Options,
  gate: Gate,
  telemetry: Telemetry,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1_440, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })
  await configureShell(context, false)
  const phase: PhaseRef = { current: 'reduced-motion' }
  const page = await newObservedPage(context, phase, telemetry, new URL(options.baseUrl).origin)
  try {
    await navigateHealth(page, options.baseUrl, 'Overview')
    const mediaMatches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
    gate.check('Reduced-motion media emulation', mediaMatches, `prefers-reduced-motion=${mediaMatches}`)

    const runChecks = page.getByRole('button', { name: 'Run checks', exact: true })
    if (await runChecks.count()) {
      await runChecks.click()
      await page.waitForTimeout(50)
    }
    const motion = await page.locator('.health-page').evaluate((root) => {
      const animatedClasses = [...root.querySelectorAll<HTMLElement>('[class*="animate-"]')]
      const missingOptOut = animatedClasses
        .filter((element) => !(element.getAttribute('class') ?? '').includes('motion-reduce:animate-none'))
        .map((element) => element.getAttribute('class') ?? '')
      const running = root.getAnimations({ subtree: true })
        .filter((animation) => animation.playState === 'running'
          && animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY)
        .length
      return { animatedClasses: animatedClasses.length, missingOptOut, running }
    })
    gate.check(
      'Health respects reduced motion',
      motion.missingOptOut.length === 0 && motion.running === 0,
      `${motion.animatedClasses} animated-class elements, ${motion.running} repeating animations, ${motion.missingOptOut.length} missing opt-outs`,
    )
  } finally {
    await context.close()
  }
}

async function verifyPrimaryExperience(
  browser: Browser,
  options: Options,
  gate: Gate,
  telemetry: Telemetry,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1_800, height: 1_000 },
    colorScheme: 'dark',
  })
  await configureShell(context, true)
  const phase: PhaseRef = { current: 'primary-overview' }
  const page = await newObservedPage(context, phase, telemetry, new URL(options.baseUrl).origin)
  try {
    await navigateHealth(page, options.baseUrl, 'Overview')
    await verifyTabStructure(page, 'Overview', gate, 'primary')
    const primaryRequests = phaseRequests(telemetry, phase.current)
    const primaryForeign = (['Agents', 'Activity', 'System'] as const)
      .flatMap((tab) => primaryRequests.filter((request) => requestMatchesTab(request, tab)).map((request) => `${tab}:${request.path}`))
    gate.check(
      'primary: inactive tabs are not mounted on Overview',
      primaryForeign.length === 0,
      primaryForeign.length === 0 ? 'no Agents/Activity/System-specific requests' : primaryForeign.join(', '),
    )
    const primaryMetrics = await layoutMetrics(page)
    gate.check(
      'primary: global activity panel is open',
      (primaryMetrics.activityPanelWidth ?? 0) >= 350,
      `measured panel width ${primaryMetrics.activityPanelWidth === null ? 'missing' : `${Math.round(primaryMetrics.activityPanelWidth)}px`}`,
    )
    await captureTop(page, options, 'wide-overview')
    const evidenceCovered = await exerciseEvidence(page, gate, options, 'wide')
    const repairCovered = await exerciseRepairDialog(page, gate, options, 'wide')

    await activateNextTabWithKeyboard(page, 'Overview', 'Agents', phase, telemetry, gate)
    await captureTop(page, options, 'wide-agents')
    await activateNextTabWithKeyboard(page, 'Agents', 'Activity', phase, telemetry, gate)
    const activityDisclosureCovered = await exerciseActivityDisclosure(page, gate, 'wide')
    await captureTop(page, options, 'wide-activity')
    await activateNextTabWithKeyboard(page, 'Activity', 'System', phase, telemetry, gate)
    await captureTop(page, options, 'wide-system')

    gate.check(
      'Keyboard disclosure coverage',
      evidenceCovered || activityDisclosureCovered,
      evidenceCovered ? 'incident evidence exercised' : activityDisclosureCovered ? 'activity details exercised' : 'no disclosure fixture was available',
    )
    if (!repairCovered) gate.skip('Repair-plan screenshot state', 'healthy fixture: conditional repair state unavailable')

    phase.current = 'system-search-deep-link'
    await page.goto(`${options.baseUrl}${HEALTH_PATH}?tab=system&section=search`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await waitForHealth(page)
    await waitForTabContent(page, 'System')
    const focusedSearch = await page.locator('[aria-label="Search subsystem detail"]').evaluate(
      (element) => document.activeElement === element,
    )
    gate.check('System section=search focus', focusedSearch, `Search detail focused=${focusedSearch}`)

    const systemMetrics = await layoutMetrics(page)
    verifyInternalTables(gate, systemMetrics, 'wide System')
    await verifyPollingIsolation(page, phase, telemetry, gate, options.quick)
    verifyActivityNoise(gate, telemetry)
  } finally {
    await context.close()
  }
}

function summarizeRequests(telemetry: Telemetry): Array<{ path: string; count: number }> {
  const counts = new Map<string, number>()
  for (const request of telemetry.requests) {
    if (!request.path.includes('/api/plugins/health/')) continue
    counts.set(request.path, (counts.get(request.path) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
}

function verifyCleanRuntime(gate: Gate, telemetry: Telemetry): void {
  const unexpectedTransports = telemetry.transportFailures.filter((failure) => !expectedCancellation(failure))
  const unexpectedConsole = telemetry.console.filter((entry) => !expectedConsoleNoise(entry))
  const expectedConsole = telemetry.console.length - unexpectedConsole.length
  gate.check(
    'No failed HTTP responses',
    telemetry.httpFailures.length === 0,
    telemetry.httpFailures.length === 0
      ? 'zero same-origin 4xx/5xx responses'
      : telemetry.httpFailures.map((failure) => `${failure.status} ${failure.method} ${failure.url} [${failure.phase}]`).join(' | '),
  )
  gate.check(
    'No unexpected failed requests',
    unexpectedTransports.length === 0,
    unexpectedTransports.length === 0
      ? `${telemetry.transportFailures.length} expected abort(s), zero unexpected transport failures`
      : unexpectedTransports.map((failure) => `${failure.method} ${failure.url}: ${failure.reason} [${failure.phase}]`).join(' | '),
  )
  gate.check(
    'Browser console is clean',
    unexpectedConsole.length === 0 && telemetry.pageErrors.length === 0,
    unexpectedConsole.length === 0 && telemetry.pageErrors.length === 0
      ? `zero unexpected warnings, console errors, or page errors${expectedConsole > 0 ? `; ${expectedConsole} expected dev EventSource reconnect warning(s)` : ''}`
      : [
          ...unexpectedConsole.map((entry) => `${entry.type}: ${entry.text} [${entry.phase}]${entry.location ? ` @ ${entry.location}` : ''}`),
          ...telemetry.pageErrors.map((entry) => `pageerror: ${entry.message} [${entry.phase}]`),
        ].join(' | '),
  )
}

async function assertServer(baseUrl: string): Promise<void> {
  let response: globalThis.Response
  try {
    response = await fetch(`${baseUrl}${PREFLIGHT_PATH}`, { signal: AbortSignal.timeout(5_000) })
  } catch (error) {
    throw new Error(`Bakin is not reachable at ${baseUrl}. Start it with \`bun run dev:mock\`. ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error(`Bakin preflight returned HTTP ${response.status} at ${baseUrl}${PREFLIGHT_PATH}`)
}

function writeReport(options: Options, gate: Gate, telemetry: Telemetry): void {
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    outputDir: options.outputDir,
    options: { headed: options.headed, quick: options.quick, screenshots: options.screenshots },
    summary: {
      passed: gate.results.filter((result) => result.kind === 'pass').length,
      failed: gate.failures.length,
      skipped: gate.results.filter((result) => result.kind === 'skip').length,
      knownLimits: gate.results.filter((result) => result.kind === 'known-limit').length,
    },
    results: gate.results,
    requestTrace: summarizeRequests(telemetry),
    runtime: {
      httpFailures: telemetry.httpFailures,
      transportFailures: telemetry.transportFailures,
      console: telemetry.console,
      pageErrors: telemetry.pageErrors,
    },
  }
  writeFileSync(join(options.outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  mkdirSync(options.outputDir, { recursive: true })
  const gate = new Gate()
  const telemetry = emptyTelemetry()
  console.log(`\nHealth browser verification\n  target: ${options.baseUrl}\n  artifacts: ${options.outputDir}\n`)

  await assertServer(options.baseUrl)
  gate.pass('Server preflight', `${options.baseUrl}${PREFLIGHT_PATH} is reachable`)

  let browser: Browser | null = null
  try {
    browser = await chromium.launch({ headless: !options.headed })
    await verifyPrimaryExperience(browser, options, gate, telemetry)

    for (const target of CONTAINER_TARGETS) {
      await verifyResponsiveState(browser, options, gate, telemetry, {
        label: `container-${target}-panel-open`,
        viewportWidth: target + DESKTOP_SHELL_WIDTH,
        activityOpen: true,
        expectedHealthWidth: target,
      })
    }

    for (const viewportWidth of PHONE_VIEWPORTS) {
      await verifyResponsiveState(browser, options, gate, telemetry, {
        label: `phone-${viewportWidth}-panel-open`,
        viewportWidth,
        activityOpen: true,
        knownShellLimit: true,
      })
      await verifyResponsiveState(browser, options, gate, telemetry, {
        label: `phone-${viewportWidth}-health-only`,
        viewportWidth,
        activityOpen: false,
        expectedHealthWidth: viewportWidth,
      })
    }

    await verifyReducedMotion(browser, options, gate, telemetry)
  } catch (error) {
    gate.fail('Verifier execution', error instanceof Error ? error.stack ?? error.message : String(error))
  } finally {
    await browser?.close().catch(() => {})
  }

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  verifyCleanRuntime(gate, telemetry)
  writeReport(options, gate, telemetry)

  const passed = gate.results.filter((result) => result.kind === 'pass').length
  const skipped = gate.results.filter((result) => result.kind === 'skip').length
  const known = gate.results.filter((result) => result.kind === 'known-limit').length
  console.log(`\nHealth browser verification: ${passed} passed, ${gate.failures.length} failed, ${skipped} skipped, ${known} known shell limits`)
  console.log(`Report: ${join(options.outputDir, 'report.json')}`)
  if (gate.failures.length > 0) process.exitCode = 1
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
