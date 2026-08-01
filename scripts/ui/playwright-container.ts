import { arch, platform } from 'node:os'
import { resolve } from 'node:path'

import {
  CANONICAL_PLAYWRIGHT_IMAGE,
  currentCanonicalEnvironment,
  validateCanonicalEnvironment,
} from './canonical-playwright.mjs'

const REPO_ROOT = resolve(import.meta.dir, '../..')

export type VisualRunMode = 'render' | 'update'

async function run(command: string[], env: Record<string, string | undefined> = {}): Promise<number> {
  const process = Bun.spawn(command, {
    cwd: REPO_ROOT,
    env: { ...globalThis.process.env, ...env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return process.exited
}

function canonicalCommand(mode: VisualRunMode): string {
  return mode === 'update' ? '--run-update' : '--run-tests'
}

function isCanonical(mode: VisualRunMode): boolean {
  return validateCanonicalEnvironment(currentCanonicalEnvironment(), mode).length === 0
}

function dockerCommand(commandName: string): string[] {
  const user = typeof process.getuid === 'function' && typeof process.getgid === 'function'
    ? [`${process.getuid()}:${process.getgid()}`]
    : []
  const command = [
    'docker', 'run', '--rm', '--init', '--pull=missing',
    '--platform', 'linux/amd64',
    '--ipc=host',
    ...(user.length > 0 ? ['--user', user[0]] : []),
    '--volume', `${REPO_ROOT}:/work`,
    '--workdir', '/work',
    '--env', `BAKIN_UI_CANONICAL_IMAGE=${CANONICAL_PLAYWRIGHT_IMAGE}`,
    '--env', 'BAKIN_UI_STORYBOOK_PREBUILT=1',
    '--env', 'XDG_CACHE_HOME=/tmp/bakin-playwright-cache',
    '--env', 'XDG_CONFIG_HOME=/tmp/bakin-playwright-config',
  ]
  if (process.env.BAKIN_UI_VISUAL_SEED_DIFF) {
    command.push('--env', 'BAKIN_UI_VISUAL_SEED_DIFF=1')
  }
  if (process.env.BAKIN_UI_BROWSER_PROJECT) {
    command.push('--env', `BAKIN_UI_BROWSER_PROJECT=${process.env.BAKIN_UI_BROWSER_PROJECT}`)
  }
  command.push(
    CANONICAL_PLAYWRIGHT_IMAGE,
    'node', 'scripts/ui/canonical-playwright.mjs', commandName,
  )
  return command
}

export async function runCanonicalVisual(mode: VisualRunMode): Promise<void> {
  if (mode === 'update' && process.env.CI) {
    throw new Error('CI is never allowed to update visual baselines')
  }
  if (mode === 'update' && process.env.BAKIN_UI_VISUAL_SEED_DIFF) {
    throw new Error('Refusing to update snapshots while BAKIN_UI_VISUAL_SEED_DIFF is set')
  }

  if (isCanonical(mode)) {
    const exitCode = await run(['node', 'scripts/ui/canonical-playwright.mjs', canonicalCommand(mode)])
    if (exitCode !== 0) throw new Error(`Canonical Playwright ${mode} failed with exit code ${exitCode}`)
    return
  }
  if (process.env.CI) {
    throw new Error(`CI visual tests must run in ${CANONICAL_PLAYWRIGHT_IMAGE}`)
  }

  console.log(`Running visual ${mode} in ${CANONICAL_PLAYWRIGHT_IMAGE} (linux/amd64) from ${platform()}/${arch()}.`)
  const buildExit = await run(['bun', 'run', 'ui:build:public'])
  if (buildExit !== 0) throw new Error(`Public Storybook build failed with exit code ${buildExit}`)
  const exitCode = await run(dockerCommand(canonicalCommand(mode)))
  if (exitCode !== 0) throw new Error(`Canonical Docker visual ${mode} failed with exit code ${exitCode}`)
}

export async function runCanonicalBrowsers(): Promise<void> {
  if (isCanonical('render')) {
    const exitCode = await run(['node', 'scripts/ui/canonical-playwright.mjs', '--run-browsers'])
    if (exitCode !== 0) throw new Error(`Canonical browser suite failed with exit code ${exitCode}`)
    return
  }
  if (process.env.CI) {
    throw new Error(`CI browser tests must run in ${CANONICAL_PLAYWRIGHT_IMAGE}`)
  }

  console.log(`Running browser behavior tests in ${CANONICAL_PLAYWRIGHT_IMAGE} (linux/amd64) from ${platform()}/${arch()}.`)
  const buildExit = await run(['bun', 'run', 'ui:build:public'])
  if (buildExit !== 0) throw new Error(`Public Storybook build failed with exit code ${buildExit}`)
  const exitCode = await run(dockerCommand('--run-browsers'))
  if (exitCode !== 0) throw new Error(`Canonical Docker browser suite failed with exit code ${exitCode}`)
}
