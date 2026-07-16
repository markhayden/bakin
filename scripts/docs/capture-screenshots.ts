#!/usr/bin/env bun
import { existsSync, readFileSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { execSync, spawn as nodeSpawn } from 'child_process'
import { load as loadYaml } from 'js-yaml'
import { chromium, type BrowserContext, type Page } from 'playwright'
import sharp from 'sharp'

const PROJECT_ROOT = resolve(import.meta.dirname, '../..')
const MANIFEST_PATH = join(PROJECT_ROOT, 'scripts/docs/screenshot-manifest.yaml')

interface Action {
  click?: string
  waitFor?: string
  type?: { selector: string; text: string }
  scroll?: string
}

interface ScreenshotEntry {
  id: string
  doc: string
  route: string
  selector?: string
  caption: string
  waitFor?: string
  delay?: number
  actions?: Action[]
  viewport?: { width: number; height: number }
  fullPage?: boolean
  skip?: boolean
  debug?: boolean
  cropHeight?: number
  cropHeightPx?: number
  cropLeft?: number
  gradient?: 'left-to-right' | 'right-to-left'
}

interface ManifestSettings {
  baseUrl: string
  defaultViewport: { width: number; height: number }
  deviceScaleFactor: number
  colorScheme: string
  outputDir: string
}

interface Manifest {
  settings: ManifestSettings
  screenshots: ScreenshotEntry[]
}

function loadManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, 'utf-8')
  return loadYaml(raw) as Manifest
}

async function ensureBrowser(): Promise<void> {
  if (existsSync(chromium.executablePath())) return

  try {
    execSync('bunx playwright install chromium', { cwd: PROJECT_ROOT, stdio: 'inherit' })
  } catch {
    throw new Error('Failed to install Playwright Chromium browser')
  }
}

async function isServerRunning(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/plugins/health/summary`, { signal: AbortSignal.timeout(2_000) })
    return res.ok
  } catch {
    return false
  }
}

async function startMockServer(): Promise<import('child_process').ChildProcess> {
  console.log('Starting dev:mock server...')
  const proc = nodeSpawn('bun', ['run', 'dev:mock'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, BAKIN_SEED_USAGE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  })
  return proc
}

async function waitForServer(baseUrl: string): Promise<void> {
  const maxRetries = 90
  const intervalMs = 1000
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/plugins/health/summary`)
      if (res.ok) {
        console.log(`Server ready after ${i + 1}s`)
        return
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Server at ${baseUrl} did not become ready within ${maxRetries}s`)
}

function killProcessTree(pid: number): void {
  try {
    execSync(`pkill -P ${pid}`, { stdio: 'ignore' })
  } catch { /* best effort */ }
  try { process.kill(pid, 'SIGTERM') } catch { /* already dead */ }
}

async function executeActions(page: Page, actions: Action[]): Promise<void> {
  for (const action of actions) {
    if (action.click) {
      await page.locator(action.click).first().click({ timeout: 5_000 })
    }
    if (action.waitFor) {
      await page.locator(action.waitFor).first().waitFor({ state: 'visible', timeout: 10_000 })
    }
    if (action.type) {
      await page.locator(action.type.selector).first().fill(action.type.text)
    }
    if (action.scroll) {
      await page.locator(action.scroll).first().scrollIntoViewIfNeeded()
    }
  }
}

async function applyGradientOverlay(imagePath: string, direction: 'left-to-right' | 'right-to-left'): Promise<void> {
  const metadata = await sharp(imagePath).metadata()
  const { width, height } = metadata
  if (!width || !height) return

  // Build an SVG gradient: black on one side, transparent on the other
  const x1 = direction === 'left-to-right' ? '0%' : '100%'
  const x2 = direction === 'left-to-right' ? '100%' : '0%'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="${x1}" y1="0%" x2="${x2}" y2="0%">
        <stop offset="0%" stop-color="black" stop-opacity="1"/>
        <stop offset="45%" stop-color="black" stop-opacity="0.7"/>
        <stop offset="70%" stop-color="black" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="black" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
  </svg>`

  const overlay = Buffer.from(svg)
  const result = await sharp(imagePath).composite([{ input: overlay, blend: 'over' }]).toBuffer()
  await sharp(result).toFile(imagePath)
}

async function captureScreenshot(
  context: BrowserContext,
  settings: ManifestSettings,
  entry: ScreenshotEntry,
  outputDir: string,
): Promise<void> {
  const page = await context.newPage()

  try {
    if (entry.viewport) {
      await page.setViewportSize(entry.viewport)
    }

    if (entry.debug) {
      await page.addInitScript(() => {
        localStorage.setItem('bakin-debug', 'true')
      })
    }

    await page.goto(`${settings.baseUrl}${entry.route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })

    // Let the React app mount and SSE data arrive
    await page.waitForTimeout(2_000)

    if (entry.waitFor) {
      await page.locator(entry.waitFor).first().waitFor({ state: 'visible', timeout: 15_000 })
    }

    if (entry.actions) {
      await executeActions(page, entry.actions)
    }

    if (entry.delay) {
      await page.waitForTimeout(entry.delay)
    }

    const docSlug = entry.doc.replace(/\//g, '-')
    const filename = `${docSlug}--${entry.id}.png`
    const outputPath = join(outputDir, filename)

    if (entry.selector) {
      const locator = page.locator(entry.selector).first()
      await locator.waitFor({ state: 'visible', timeout: 10_000 })
      if (entry.cropHeight || entry.cropHeightPx) {
        const box = await locator.boundingBox()
        if (box) {
          const height = entry.cropHeightPx
            ? Math.min(box.height, entry.cropHeightPx)
            : box.height * entry.cropHeight!
          await page.screenshot({
            path: outputPath,
            clip: { x: box.x, y: box.y, width: box.width, height },
            animations: 'disabled',
          })
        } else {
          await locator.screenshot({ path: outputPath, animations: 'disabled' })
        }
      } else {
        await locator.screenshot({ path: outputPath, animations: 'disabled' })
      }
    } else {
      if (entry.cropHeight) {
        const vp = page.viewportSize()!
        await page.screenshot({
          path: outputPath,
          clip: { x: 0, y: 0, width: vp.width, height: vp.height * entry.cropHeight },
          animations: 'disabled',
        })
      } else {
        await page.screenshot({
          path: outputPath,
          fullPage: entry.fullPage ?? false,
          animations: 'disabled',
        })
      }
    }

    if (entry.cropLeft) {
      const meta = await sharp(outputPath).metadata()
      if (meta.width && meta.height) {
        const left = Math.round(meta.width * entry.cropLeft)
        await sharp(outputPath)
          .extract({ left, top: 0, width: meta.width - left, height: meta.height })
          .toFile(outputPath + '.tmp')
        renameSync(outputPath + '.tmp', outputPath)
      }
    }

    if (entry.gradient) {
      await applyGradientOverlay(outputPath, entry.gradient)
    }

    await optimizeImage(outputPath)
  } finally {
    await page.close()
  }
}

const MAX_WIDTH = 1600

async function optimizeImage(pngPath: string): Promise<void> {
  const webpPath = pngPath.replace(/\.png$/, '.webp')
  await sharp(pngPath)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(webpPath)
  unlinkSync(pngPath)
}

function parseFilters(): { doc?: string; id?: string } {
  const args = process.argv.slice(2)
  const filters: { doc?: string; id?: string } = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--doc' && args[i + 1]) filters.doc = args[++i]
    else if (args[i] === '--id' && args[i + 1]) filters.id = args[++i]
    else if (!args[i].startsWith('--')) filters.doc = args[i]
  }
  return filters
}

async function main(): Promise<void> {
  const manifest = loadManifest()
  const settings = {
    ...manifest.settings,
    baseUrl: process.env.BAKIN_SCREENSHOT_BASE_URL ?? manifest.settings.baseUrl,
  }
  const { screenshots } = manifest
  const filters = parseFilters()

  let candidates = screenshots.filter((s) => !s.skip)
  if (filters.doc) {
    const match = filters.doc
    candidates = candidates.filter((s) => s.doc === match || s.doc.includes(match))
  }
  if (filters.id) {
    const match = filters.id
    candidates = candidates.filter((s) => s.id === match || s.id.includes(match))
  }

  const skipped = screenshots.length - candidates.length

  if (candidates.length === 0) {
    console.log('No screenshots match the filter.')
    return
  }

  const filterDesc = filters.doc || filters.id ? ` matching "${filters.doc || filters.id}"` : ''
  console.log(`\nCapturing ${candidates.length} screenshot(s)${filterDesc} (${skipped} skipped)\n`)

  await ensureBrowser()

  // Use an existing server if one is already running, otherwise start one
  const serverAlreadyRunning = await isServerRunning(settings.baseUrl)
  let mockProcess: import('child_process').ChildProcess | null = null

  if (serverAlreadyRunning) {
    console.log('Using existing server at', settings.baseUrl)
  } else {
    mockProcess = await startMockServer()
    await waitForServer(settings.baseUrl)
  }

  let browser

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      viewport: settings.defaultViewport,
      deviceScaleFactor: settings.deviceScaleFactor,
      colorScheme: settings.colorScheme as 'dark' | 'light',
      reducedMotion: 'reduce',
    })

    const outputDir = join(PROJECT_ROOT, settings.outputDir)
    mkdirSync(outputDir, { recursive: true })

    let succeeded = 0
    let failed = 0

    for (const entry of candidates) {
      try {
        await captureScreenshot(context, settings, entry, outputDir)
        succeeded++
        console.log(`  \x1b[32mok\x1b[0m  ${entry.doc}/${entry.id}`)
      } catch (err) {
        failed++
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  \x1b[31mFAIL\x1b[0m  ${entry.doc}/${entry.id}: ${msg}`)
      }
    }

    console.log(`\nDone: ${succeeded} captured, ${failed} failed, ${skipped} skipped`)

    await context.close()
    await browser.close()
    browser = undefined

    if (failed > 0) process.exit(1)
  } finally {
    browser?.close().catch(() => {})
    if (mockProcess?.pid) {
      killProcessTree(mockProcess.pid)
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
