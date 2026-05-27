#!/usr/bin/env bun
import { readFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { load as loadYaml } from 'js-yaml'
import { chromium, type BrowserContext, type Page } from 'playwright'

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
  const result = Bun.spawnSync(['bunx', 'playwright', 'install', 'chromium'], {
    cwd: PROJECT_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (result.exitCode !== 0) {
    throw new Error('Failed to install Playwright Chromium browser')
  }
}

async function startMockServer(): Promise<Bun.Subprocess> {
  console.log('Starting dev:mock server...')
  const proc = Bun.spawn(['bun', 'run', 'dev:mock'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, BAKIN_SEED_USAGE: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return proc
}

async function waitForServer(baseUrl: string): Promise<void> {
  const maxRetries = 90
  const intervalMs = 1000
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`)
      if (res.ok) {
        console.log(`Server ready after ${i + 1}s`)
        return
      }
    } catch {
      // not ready yet
    }
    await Bun.sleep(intervalMs)
  }
  throw new Error(`Server at ${baseUrl} did not become ready within ${maxRetries}s`)
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

    // Set debug mode in localStorage before navigation so the app
    // picks it up on first render — no flash of non-debug state.
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
      if (entry.cropHeight) {
        const box = await locator.boundingBox()
        if (box) {
          await page.screenshot({
            path: outputPath,
            clip: { x: box.x, y: box.y, width: box.width, height: box.height * entry.cropHeight },
          })
        } else {
          await locator.screenshot({ path: outputPath })
        }
      } else {
        await locator.screenshot({ path: outputPath })
      }
    } else {
      if (entry.cropHeight) {
        const vp = page.viewportSize()!
        await page.screenshot({
          path: outputPath,
          clip: { x: 0, y: 0, width: vp.width, height: vp.height * entry.cropHeight },
        })
      } else {
        await page.screenshot({
          path: outputPath,
          fullPage: entry.fullPage ?? false,
        })
      }
    }
  } finally {
    await page.close()
  }
}

async function main(): Promise<void> {
  const manifest = loadManifest()
  const { settings, screenshots } = manifest

  const entries = screenshots.filter((s) => !s.skip)
  const skipped = screenshots.filter((s) => s.skip)

  if (entries.length === 0) {
    console.log('No screenshots to capture.')
    return
  }

  console.log(`\nCapturing ${entries.length} screenshots (${skipped.length} skipped)\n`)

  await ensureBrowser()

  const mockProcess = await startMockServer()
  let browser

  try {
    await waitForServer(settings.baseUrl)

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      viewport: settings.defaultViewport,
      deviceScaleFactor: settings.deviceScaleFactor,
      colorScheme: settings.colorScheme as 'dark' | 'light',
    })

    const outputDir = join(PROJECT_ROOT, settings.outputDir)
    mkdirSync(outputDir, { recursive: true })

    let succeeded = 0
    let failed = 0

    for (const entry of entries) {
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

    console.log(`\nDone: ${succeeded} captured, ${failed} failed, ${skipped.length} skipped`)

    await context.close()
    await browser.close()
    browser = undefined

    if (failed > 0) process.exit(1)
  } finally {
    browser?.close().catch(() => {})
    mockProcess.kill()
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
