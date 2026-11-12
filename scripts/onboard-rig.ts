#!/usr/bin/env bun
/**
 * onboard:rig — run the real `bakin onboard` against a throwaway home, in
 * your terminal, as many times as you like.
 *
 *   bun run onboard:rig                         # nothing installed, nothing stored
 *   bun run onboard:rig --runtime pi            # Pi installed, logged out
 *   bun run onboard:rig --runtime pi --auth fake
 *   bun run onboard:rig --runtime pi --auth copy   # a COPY of your Pi login
 *   bun run onboard:rig --runtime openclaw      # OpenClaw home + gateway stand-in
 *   bun run onboard:rig --runtime both
 *   bun run onboard:rig --stored pi             # settings already name a runtime
 *   bun run onboard:rig --keep                  # leave the home for a second run
 *   bun run onboard:rig --home <dir>            # reuse a kept home
 *   bun run onboard:rig -- --yes --json         # everything after -- goes to `bakin onboard`
 *
 * It uses the same closed environment as the onboarding test harness
 * (tests/integration/onboarding/harness.ts): every home the CLI can
 * resolve lives in one temp tree, `launchctl`/`systemctl` are recording
 * stand-ins, and outside network requests go to a deny proxy. Your real
 * ~/.bakin, ~/.pi, ~/.openclaw and the search service are never written;
 * the rig fingerprints them before and after and says so.
 *
 * `--auth copy` only READS ~/.pi/agent/auth.json and writes the copy into
 * the throwaway Pi home. `--network` lets the run reach the internet (for
 * trying the recommended installs for real); everything else stays closed.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { seedOpenClaw, seedPi, storeAdapter, type OpenClawFixture } from '../tests/integration/onboarding/fixtures'
import { createOnboardingHome, diffTrees, REPO_ROOT, snapshotTree, type OnboardingHome } from '../tests/integration/onboarding/harness'

type RuntimeChoice = 'none' | 'pi' | 'openclaw' | 'both'
type AuthChoice = 'none' | 'fake' | 'copy'

interface RigOptions {
  runtime: RuntimeChoice
  auth: AuthChoice
  stored: string | null
  keep: boolean
  network: boolean
  home: string | null
  onboardArgs: string[]
}

const USAGE = 'Usage: bun run onboard:rig [--runtime none|pi|openclaw|both] [--auth none|fake|copy] [--stored <adapter>] [--keep] [--home <dir>] [--network] [-- <bakin onboard args>]'

function fail(message: string): never {
  console.error(`onboard:rig: ${message}\n${USAGE}`)
  process.exit(1)
}

export function parseRigArgs(argv: string[]): RigOptions {
  const options: RigOptions = { runtime: 'none', auth: 'none', stored: null, keep: false, network: false, home: null, onboardArgs: [] }
  const split = argv.indexOf('--')
  const own = split === -1 ? argv : argv.slice(0, split)
  options.onboardArgs = split === -1 ? [] : argv.slice(split + 1)
  for (let i = 0; i < own.length; i++) {
    const arg = own[i]!
    const value = (): string => own[++i] ?? fail(`${arg} needs a value`)
    if (arg === '--runtime') {
      const choice = value()
      if (choice !== 'none' && choice !== 'pi' && choice !== 'openclaw' && choice !== 'both') fail(`unknown --runtime ${choice}`)
      options.runtime = choice
    } else if (arg === '--auth') {
      const choice = value()
      if (choice !== 'none' && choice !== 'fake' && choice !== 'copy') fail(`unknown --auth ${choice}`)
      options.auth = choice
    } else if (arg === '--stored') options.stored = value()
    else if (arg === '--home') options.home = value()
    else if (arg === '--keep') options.keep = true
    else if (arg === '--network') options.network = true
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      process.exit(0)
    } else fail(`unknown option ${arg}`)
  }
  return options
}

/** What must not change: name → a fingerprint of its top level (names + mtimes + sizes). */
function fingerprintRealHomes(): Record<string, string> {
  const home = homedir()
  const targets: Record<string, string> = {
    '~/.bakin': join(home, '.bakin'),
    '~/.pi/agent': join(home, '.pi', 'agent'),
    '~/.openclaw': join(home, '.openclaw'),
    '~/.antfly': join(home, '.antfly'),
    'search service unit': join(home, 'Library', 'LaunchAgents', 'io.bakin.antfly.plist'),
  }
  const out: Record<string, string> = {}
  for (const [label, path] of Object.entries(targets)) {
    if (!existsSync(path)) {
      out[label] = 'absent'
      continue
    }
    const stat = statSync(path)
    if (!stat.isDirectory()) {
      out[label] = `${stat.mtimeMs}:${stat.size}`
      continue
    }
    const entries = readdirSync(path).sort().map((name) => {
      const entry = statSync(join(path, name), { throwIfNoEntry: false })
      return `${name}:${entry?.mtimeMs ?? 'gone'}:${entry?.size ?? 0}`
    })
    out[label] = `${stat.mtimeMs}|${entries.join(',')}`
  }
  return out
}

function copyPiLogin(home: OnboardingHome): void {
  const source = join(homedir(), '.pi', 'agent', 'auth.json')
  if (!existsSync(source)) fail(`--auth copy: no Pi login found at ${source}. Log in with pi's /login first, or use --auth fake.`)
  const agentDir = join(home.piHome, 'agent')
  mkdirSync(agentDir, { recursive: true })
  copyFileSync(source, join(agentDir, 'auth.json'))
}

async function main(): Promise<void> {
  const options = parseRigArgs(process.argv.slice(2))
  const realBefore = fingerprintRealHomes()

  const home = await createOnboardingHome()
  let gateway: OpenClawFixture | null = null
  if (options.home) {
    // A kept home: point this run's environment at it instead of the fresh tree.
    if (!existsSync(options.home)) fail(`--home ${options.home} does not exist`)
    for (const [key, sub] of [['BAKIN_HOME', 'bakin'], ['PI_HOME', 'pi'], ['OPENCLAW_HOME', 'openclaw'], ['ANTFLY_HOME', 'antfly'], ['HOME', 'home']] as const) {
      home.env[key] = join(options.home, sub)
    }
    home.env.PI_CODING_AGENT_DIR = join(options.home, 'pi', 'agent')
  } else {
    if (options.runtime === 'pi' || options.runtime === 'both') {
      seedPi(home, { auth: options.auth === 'fake' })
      if (options.auth === 'copy') copyPiLogin(home)
    }
    if (options.runtime === 'openclaw' || options.runtime === 'both') {
      gateway = await seedOpenClaw(home, { auth: options.auth !== 'none' })
    }
    if (options.stored) storeAdapter(home, options.stored)
  }
  if (options.network) {
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'GIT_ALLOW_PROTOCOL']) delete home.env[key]
  }
  // A terminal run should look like one.
  delete home.env.NO_COLOR
  if (process.env.TERM) home.env.TERM = process.env.TERM

  const watchedRoot = options.home ?? home.root
  const before = snapshotTree(watchedRoot)
  console.error(`onboard:rig: throwaway home ${watchedRoot}`)
  console.error(`onboard:rig: runtime=${options.runtime} auth=${options.auth} stored=${options.stored ?? 'nothing'} network=${options.network ? 'open' : 'denied'}`)
  console.error(`onboard:rig: bakin onboard ${options.onboardArgs.join(' ')}\n`)

  const child = spawn(process.execPath, ['--no-env-file', join(REPO_ROOT, 'cli', 'bakin.ts'), 'onboard', ...options.onboardArgs], {
    cwd: REPO_ROOT,
    env: home.env,
    stdio: 'inherit',
  })
  // Ctrl-C belongs to the wizard; the rig waits for it to finish.
  process.on('SIGINT', () => {})
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code))
  })

  const diff = diffTrees(before, snapshotTree(watchedRoot))
  const files = (list: string[]) => list.filter((entry) => !entry.endsWith('/') && !entry.startsWith('harness-record/') && !entry.startsWith('home/Library/'))
  console.error(`\nonboard:rig: bakin onboard exited ${String(exitCode)}`)
  console.error(`onboard:rig: wrote ${files(diff.added).length} new file(s), changed ${files(diff.changed).length}, removed ${files(diff.removed).length}`)
  for (const entry of [...files(diff.added).map((f) => `  + ${f}`), ...files(diff.changed).map((f) => `  ~ ${f}`), ...files(diff.removed).map((f) => `  - ${f}`)].slice(0, 40)) console.error(entry)

  const { commands, network } = home.violations()
  if (commands.length > 0) console.error(`onboard:rig: service supervisor calls (refused): ${commands.join('; ')}`)
  if (!options.network && network.length > 0) console.error(`onboard:rig: outside requests (denied): ${[...new Set(network)].join('; ')}`)

  const realAfter = fingerprintRealHomes()
  const touched = Object.keys(realBefore).filter((label) => realBefore[label] !== realAfter[label])
  if (touched.length === 0) console.error('onboard:rig: real homes and the search service unit are unchanged')
  else console.error(`onboard:rig: WARNING — changed during the run (by this rig or by something else on this machine): ${touched.join(', ')}`)

  await gateway?.stop()
  if (options.keep || options.home) {
    console.error(`onboard:rig: kept ${watchedRoot}\n  run again on it: bun run onboard:rig --home ${watchedRoot} -- <args>\n  remove it: rm -rf ${watchedRoot}`)
    if (options.home) await home.cleanup()
    else process.exit(exitCode ?? 1) // the deny proxy dies with the process; the tree stays
  } else {
    await home.cleanup()
  }
  process.exit(exitCode ?? 1)
}

if (import.meta.main) await main()
