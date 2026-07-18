#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const CANONICAL_PLAYWRIGHT_IMAGE = 'mcr.microsoft.com/playwright:v1.60.0-noble'
const CANONICAL_PLAYWRIGHT_VERSION = CANONICAL_PLAYWRIGHT_IMAGE.match(/:v([0-9]+\.[0-9]+\.[0-9]+)-/)?.[1]
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/**
 * @param {{ platform: string, architecture: string, imageMarker: string, osRelease: string, playwrightVersion: string, ci: boolean }} input
 * @param {'render' | 'update'} mode
 */
export function validateCanonicalEnvironment(input, mode) {
  const violations = []
  if (input.platform !== 'linux') violations.push(`visual baselines require Linux, received ${input.platform}`)
  if (input.architecture !== 'x64') violations.push(`visual baselines require x64, received ${input.architecture}`)
  if (input.imageMarker !== CANONICAL_PLAYWRIGHT_IMAGE) {
    violations.push(`missing canonical image marker ${CANONICAL_PLAYWRIGHT_IMAGE}`)
  }
  if (!/(?:^|\n)ID=['"]?ubuntu['"]?(?:\n|$)/.test(input.osRelease)
    || !/(?:^|\n)VERSION_CODENAME=['"]?noble['"]?(?:\n|$)/.test(input.osRelease)) {
    violations.push('visual baselines require Ubuntu Noble')
  }
  if (input.playwrightVersion !== CANONICAL_PLAYWRIGHT_VERSION) {
    violations.push(`Playwright package ${input.playwrightVersion || '(missing)'} does not match ${CANONICAL_PLAYWRIGHT_IMAGE}`)
  }
  if (mode === 'update' && input.ci) violations.push('CI is never allowed to update visual baselines')
  return violations
}

export function currentCanonicalEnvironment() {
  let osRelease = ''
  let playwrightVersion = ''
  try {
    osRelease = readFileSync('/etc/os-release', 'utf-8')
  } catch {
    // Non-Linux hosts are rejected by platform before the missing release
    // metadata matters.
  }
  try {
    playwrightVersion = JSON.parse(
      readFileSync(join(REPO_ROOT, 'node_modules/playwright/package.json'), 'utf-8'),
    ).version
  } catch {
    // A missing Playwright install is reported as a canonical-environment
    // violation with the other preflight failures.
  }
  return {
    platform: platform(),
    architecture: arch(),
    imageMarker: process.env.BAKIN_UI_CANONICAL_IMAGE ?? '',
    osRelease,
    playwrightVersion,
    ci: Boolean(process.env.CI),
  }
}

function assertCanonical(mode) {
  const violations = validateCanonicalEnvironment(currentCanonicalEnvironment(), mode)
  if (violations.length > 0) {
    throw new Error(`Refusing non-canonical visual ${mode}:\n${violations.map((entry) => `- ${entry}`).join('\n')}`)
  }
}

function runPlaywright(update) {
  assertCanonical(update ? 'update' : 'render')
  if (update && process.env.BAKIN_UI_VISUAL_SEED_DIFF) {
    throw new Error('Refusing to update snapshots while BAKIN_UI_VISUAL_SEED_DIFF is set')
  }
  const executable = join(REPO_ROOT, 'node_modules/.bin/playwright')
  const args = ['test', '--config=playwright.ui.config.ts']
  if (update) args.push('--update-snapshots=all')
  const result = spawnSync(executable, args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
}

function main() {
  const command = process.argv[2]
  if (command === '--check-render') assertCanonical('render')
  else if (command === '--run-tests') runPlaywright(false)
  else if (command === '--run-update') runPlaywright(true)
  else throw new Error('Expected --check-render, --run-tests, or --run-update')
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
