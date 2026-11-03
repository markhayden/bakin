/**
 * Real-browser geometry for the Memory results table (#1040).
 *
 * The bug was a layout-engine effect no DOM test can see: under automatic
 * table layout the snippet's long single line out-weighed every title, so
 * Title collapsed to ~85px in a 2000px table and broke mid-word into eight
 * lines while Snippet took the rest. This builds the plugin's own UI fixture
 * (the one `bun run test:ui` screenshots), serves it, and measures the table
 * in Chromium at a wide and a narrower desktop width plus the mobile list.
 *
 * Run by scripts/ui/verify-plugin-conformance.ts (ui:test:conformance), which
 * sets the env flag; the plain suite skips it. Playwright loads lazily — an
 * eager import in a bun --isolate child can segfault the runner even when
 * every test in the file is skipped.
 */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { createServer } from 'http'
import { tmpdir } from 'os'
import { extname, join, resolve } from 'path'

// Defensive isolation per CLAUDE.md — the fixture bundle runs in a browser
// and never touches ~/.bakin, but the resolvers stay mocked regardless.
const testDir = mkdtempSync(join(tmpdir(), 'bakin-test-memory-layout-'))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, plugins: join(testDir, 'plugin-settings'), db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, plugins: join(testDir, 'plugin-settings'), db: join(testDir, 'bakin.db') }),
}))

const browserTest = process.env.BAKIN_UI_BROWSER_TEST === '1' ? test : test.skip
const REPO_ROOT = resolve(import.meta.dir, '../../..')
/** The plugin's own conformance fixture: the real /memory route. */
const SHELL_FIXTURE = join(REPO_ROOT, 'plugins/memory/tests/ui.fixture.tsx')
/** The table alone, so the debug-only Score column can be shown. */
const TABLE_FIXTURE = join(REPO_ROOT, 'tests/plugins/memory/fixtures/memory-table.fixture.tsx')

/** The fixture's #1040 rows — the titles the screenshot in the issue showed breaking. */
const DOTTED_TITLE = 'assets.asset.saved'
const SENTENCE_TITLE = "Iterate on what's wrong, not on the whole thing"
const EXEC_TITLE = 'exec:bakin_exec_assets_save:launch-hero-v3-final-approved-render-2026-01-15'

interface Served { url: string; stop: () => void }

async function buildAndServeFixture(name: string, entry: string, define: Record<string, string> = {}): Promise<Served> {
  const outdir = join(testDir, name)
  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: 'browser',
    format: 'esm',
    splitting: true,
    sourcemap: 'none',
    minify: false,
    naming: { entry: 'fixture.[ext]', chunk: 'chunks/[name]-[hash].[ext]', asset: 'assets/[name]-[hash].[ext]' },
    define: { 'process.env.NODE_ENV': '"production"', ...define },
  })
  if (!result.success) throw new Error(`fixture build failed:\n${result.logs.map(String).join('\n')}`)
  const stylesheets = readdirSync(outdir).filter((name) => name.endsWith('.css'))
  const html = `<!doctype html>
<html lang="en" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Memory table layout</title>
${stylesheets.map((name) => `<link rel="stylesheet" href="/${name}">`).join('\n')}
</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`
  // node:http, not Bun.serve — the suite's happy-dom preload replaces the
  // global Response, and a browser emulation body never reaches a socket.
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8' }
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname === '/') {
      response.writeHead(200, { 'content-type': types['.html']! }).end(html)
      return
    }
    const file = resolve(outdir, pathname.replace(/^\/+/, ''))
    if (!file.startsWith(outdir) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('Not found')
      return
    }
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  })
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not bind a port')
  return { url: `http://127.0.0.1:${address.port}/`, stop: () => server.close() }
}

interface CellGeometry {
  text: string
  title: string | null
  width: number
  lines: number
  /** Content wider than its cell (a nowrap date spilling into the next column). */
  overflows: boolean
}

interface TableGeometry {
  tableWidth: number
  containerClientWidth: number
  containerScrollWidth: number
  headers: Record<string, number>
  rows: Array<{ height: number; title: CellGeometry; snippet: CellGeometry; agent: CellGeometry; updated: CellGeometry }>
}

let shell: Served | undefined
let debugTable: Served | undefined
let browser: import('playwright').Browser | undefined

beforeAll(async () => {
  if (process.env.BAKIN_UI_BROWSER_TEST !== '1') return
  const { chromium } = await import('playwright')
  ;[shell, debugTable, browser] = await Promise.all([
    buildAndServeFixture('shell', SHELL_FIXTURE),
    buildAndServeFixture('debug-table', TABLE_FIXTURE, {
      'process.env.MEMORY_FIXTURE_QUERY': '"review"',
      'process.env.MEMORY_FIXTURE_DEBUG': '"1"',
    }),
    chromium.launch({ headless: true }),
  ])
}, 60_000)

afterAll(async () => {
  await browser?.close()
  shell?.stop()
  debugTable?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

async function openMemory(width: number, height: number, variant: 'shell' | 'debug' = 'shell'): Promise<import('playwright').Page> {
  const context = await browser!.newContext({ viewport: { width, height }, colorScheme: 'dark', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto((variant === 'debug' ? debugTable : shell)!.url, { waitUntil: 'networkidle' })
  await page.locator('[data-slot="data-table"]').waitFor({ state: 'visible', timeout: 10_000 })
  expect(errors).toEqual([])
  return page
}

function measureTable(page: import('playwright').Page): Promise<TableGeometry> {
  return page.evaluate(() => {
    const table = document.querySelector<HTMLTableElement>('table[aria-label="Memory results"]')
    if (!table) throw new Error('Memory results table not rendered')
    if (table.getClientRects().length === 0) throw new Error('Memory results table is hidden (list render active)')
    const container = table.closest<HTMLElement>('[data-slot="table-container"]')!
    const lineCount = (element: HTMLElement) => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight)
      return Math.round(element.getBoundingClientRect().height / lineHeight)
    }
    const cell = (element: HTMLElement): { text: string; title: string | null; width: number; lines: number; overflows: boolean } => {
      const td = element.closest<HTMLElement>('td')!
      return {
        text: element.textContent ?? '',
        title: element.getAttribute('title'),
        width: td.getBoundingClientRect().width,
        lines: lineCount(element),
        overflows: element.getBoundingClientRect().right > td.getBoundingClientRect().right + 0.5,
      }
    }
    const headers: Record<string, number> = {}
    for (const th of table.querySelectorAll<HTMLElement>('thead th')) {
      headers[(th.textContent ?? '').trim()] = th.getBoundingClientRect().width
    }
    const rows = Array.from(table.querySelectorAll<HTMLElement>('tbody tr')).map((tr) => {
      const tds = tr.querySelectorAll<HTMLElement>('td')
      return {
        height: tr.getBoundingClientRect().height,
        title: cell(tr.querySelector<HTMLElement>('[data-memory-title]')!),
        snippet: cell(tr.querySelector<HTMLElement>('[data-memory-summary]')!),
        agent: cell(tds[3]!.firstElementChild as HTMLElement),
        updated: cell(tds[4]!.firstElementChild as HTMLElement),
      }
    })
    return {
      tableWidth: table.getBoundingClientRect().width,
      containerClientWidth: container.clientWidth,
      containerScrollWidth: container.scrollWidth,
      headers,
      rows,
    }
  })
}

/**
 * Fixed widths under test: 2000 matches the screenshot in #1040, 1440 and
 * 1024 are ordinary desktops. The table/list breakpoints are container
 * widths (`collapseBelow`: 2xl = 672px, 3xl = 768px for the debug table),
 * measured on the DataTable itself, so the viewports that straddle them are
 * derived from the page chrome each fixture puts around the table rather
 * than assumed.
 */
const TABLE_VIEWPORTS = [
  { name: 'report width', width: 2000 },
  { name: 'wide desktop', width: 1440 },
  { name: 'narrower desktop', width: 1024 },
] as const
const COLLAPSE_CONTAINER = { shell: 672, debug: 768 } as const

const chromeByVariant = new Map<'shell' | 'debug', number>()
/** Viewport width minus the DataTable container width — the page's chrome. */
async function chromeWidth(variant: 'shell' | 'debug'): Promise<number> {
  const cached = chromeByVariant.get(variant)
  if (cached !== undefined) return cached
  const page = await openMemory(1440, 900, variant)
  try {
    const container = await page.locator('[data-slot="data-table"]').evaluate((node) => node.getBoundingClientRect().width)
    const chrome = 1440 - container
    chromeByVariant.set(variant, chrome)
    return chrome
  } finally {
    await page.context().close()
  }
}

function expectTableContract(geometry: TableGeometry, { score }: { score: boolean }): void {
  expect(geometry.rows.length).toBe(5)
  expect('Score' in geometry.headers).toBe(score)

  // Title owns about a third of the table at every width — the bug gave
  // it ~4% — (a little less beside the debug Score column) and Snippet, the
  // one flexible column, takes what is left: never nothing, never more than
  // twice Title.
  expect(geometry.headers.Title! / geometry.tableWidth).toBeGreaterThanOrEqual(score ? 0.30 : 0.33)
  expect(geometry.headers.Title!).toBeGreaterThan(200)
  expect(geometry.headers.Snippet!).toBeGreaterThanOrEqual(48)
  expect(geometry.headers.Snippet!).toBeLessThanOrEqual(geometry.headers.Title! * 2)

  // Declared widths never push the table wider than its container.
  expect(geometry.containerScrollWidth).toBeLessThanOrEqual(geometry.containerClientWidth)

  const byTitle = (text: string) => {
    const row = geometry.rows.find((candidate) => candidate.title.text === text)
    if (!row) throw new Error(`row "${text}" not rendered; have ${geometry.rows.map((r) => r.title.text).join(' | ')}`)
    return row
  }

  // A dotted identifier reads as one line, not three.
  expect(byTitle(DOTTED_TITLE).title.lines).toBe(1)
  // A sentence wraps at spaces and clamps at two lines, not eight.
  expect(byTitle(SENTENCE_TITLE).title.lines).toBeLessThanOrEqual(2)
  // An unbroken exec identifier wider than the column is cut at the
  // column edge, clamped at two lines, with the full title on the tooltip.
  const exec = byTitle(EXEC_TITLE)
  expect(exec.title.lines).toBeLessThanOrEqual(2)
  expect(exec.title.title).toBe(EXEC_TITLE)

  for (const row of geometry.rows) {
    expect(row.title.title).toBe(row.title.text)
    expect(row.title.lines).toBeLessThanOrEqual(2)
    expect(row.snippet.lines).toBeLessThanOrEqual(1)
    // Metadata stays readable: agent and date each on one line, inside their cells.
    expect(row.agent.lines).toBe(1)
    expect(row.agent.overflows).toBe(false)
    expect(row.updated.lines).toBe(1)
    expect(row.updated.overflows).toBe(false)
    // Two clamped lines plus cell padding — never a tall row. The Score
    // overlay stacks its legs, so the debug table is allowed to be taller.
    if (!score) expect(row.height).toBeLessThanOrEqual(64)
  }
}

for (const viewport of TABLE_VIEWPORTS) {
  browserTest(`${viewport.name} (${viewport.width}px): Title keeps its share, rows stay short, nothing scrolls sideways`, async () => {
    const page = await openMemory(viewport.width, 900)
    try {
      expectTableContract(await measureTable(page), { score: false })
    } finally {
      await page.context().close()
    }
  }, 30_000)
}

browserTest('just above the table/list breakpoint: the narrowest table the page renders keeps the contract', async () => {
  const width = COLLAPSE_CONTAINER.shell + await chromeWidth('shell') + 4
  const page = await openMemory(width, 900)
  try {
    const geometry = await measureTable(page)
    expect(geometry.containerClientWidth).toBeGreaterThanOrEqual(COLLAPSE_CONTAINER.shell)
    expect(geometry.containerClientWidth).toBeLessThan(COLLAPSE_CONTAINER.shell + 8)
    expectTableContract(geometry, { score: false })
  } finally {
    await page.context().close()
  }
}, 30_000)

browserTest('just below the table/list breakpoint: the list render takes over, every column folded in', async () => {
  const page = await openMemory(COLLAPSE_CONTAINER.shell + await chromeWidth('shell') - 4, 900)
  try {
    const list = page.getByRole('list', { name: 'Memory results' })
    await list.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('table', { name: 'Memory results' }).isVisible()).toBe(false)
    expect(await list.getByText(EXEC_TITLE).isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  } finally {
    await page.context().close()
  }
}, 30_000)

/**
 * Debug mode with a query adds the Score column — the widest the table
 * gets — and the table then collapses one step earlier (`3xl`, a 768px
 * container, i.e. below an 832px viewport). The same contract must hold,
 * Snippet included, at the report width and at the narrowest width that
 * still renders the debug table.
 */
browserTest('debug Score column, report width (2000px): Snippet keeps room and nothing scrolls sideways', async () => {
  const page = await openMemory(2000, 900, 'debug')
  try {
    expectTableContract(await measureTable(page), { score: true })
  } finally {
    await page.context().close()
  }
}, 30_000)

browserTest('debug Score column, just above its table/list breakpoint: Snippet keeps room and nothing scrolls sideways', async () => {
  const page = await openMemory(COLLAPSE_CONTAINER.debug + await chromeWidth('debug') + 4, 900, 'debug')
  try {
    const geometry = await measureTable(page)
    expect(geometry.containerClientWidth).toBeGreaterThanOrEqual(COLLAPSE_CONTAINER.debug)
    expect(geometry.containerClientWidth).toBeLessThan(COLLAPSE_CONTAINER.debug + 8)
    expectTableContract(geometry, { score: true })
  } finally {
    await page.context().close()
  }
}, 30_000)

browserTest('mobile (320px): the list render takes over and nothing scrolls sideways', async () => {
  const page = await openMemory(320, 800)
  try {
    const list = page.getByRole('list', { name: 'Memory results' })
    await list.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('table', { name: 'Memory results' }).isVisible()).toBe(false)
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
    expect(await list.getByText(EXEC_TITLE).isVisible()).toBe(true)
  } finally {
    await page.context().close()
  }
}, 30_000)

browserTest('debug Score column, just below its table/list breakpoint: the list render takes over', async () => {
  const page = await openMemory(COLLAPSE_CONTAINER.debug + await chromeWidth('debug') - 4, 900, 'debug')
  try {
    const list = page.getByRole('list', { name: 'Memory results' })
    await list.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('table', { name: 'Memory results' }).isVisible()).toBe(false)
    expect(await list.getByText(EXEC_TITLE).isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  } finally {
    await page.context().close()
  }
}, 30_000)
