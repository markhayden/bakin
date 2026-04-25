#!/usr/bin/env bun
/**
 * scripts/migration/wipe-and-install-all.ts
 *
 * Wipe every reference agent (pixel/rolo/jessica-fetcher/scout/zen/nemo/
 * basil/patch) from OpenClaw + ~/.bakin/packages/, then fresh-install
 * each from `agents/<id>/`. End state: every agent is `state: managed`
 * in the lockfile, with workspace + assets + knowledge markers projected
 * from the package source.
 *
 * Used during the agent-packages refactor (Phase G-8) to flip a
 * machine from "hand-built agents" to "package-managed agents" in one
 * pass. Reusable later when re-baselining a machine.
 *
 * Destructive: removes every workspace under ~/.openclaw/workspaces/<id>/
 * for the listed agents. OpenClaw CLI moves them to its trash dir
 * (~/.openclaw/trash/) so they're recoverable from there if needed.
 *
 * Usage:
 *   bun scripts/migration/wipe-and-install-all.ts            # the 8 default agents
 *   bun scripts/migration/wipe-and-install-all.ts pixel rolo  # subset
 *
 * Bakin server need NOT be running — the script calls `installPackage`
 * directly. After the script finishes, restart any running Bakin
 * server so the workflow source registry picks up package contributions.
 */
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'

const DEFAULT_AGENTS = [
  'pixel',
  'rolo',
  'jessica-fetcher',
  'scout',
  'zen',
  'nemo',
  'basil',
  'patch',
] as const

const REPO_ROOT = resolve(import.meta.dir, '..', '..')

interface StepResult {
  agent: string
  step: 'wipe' | 'install'
  status: 'ok' | 'skipped' | 'failed'
  message: string
}

function checkOpenClawCli(): void {
  try {
    execFileSync('openclaw', ['--version'], { stdio: 'pipe' })
  } catch {
    console.error('openclaw CLI not in PATH. Install OpenClaw first.')
    process.exit(2)
  }
}

function checkPackagesExist(agents: readonly string[]): void {
  for (const agent of agents) {
    const pkgPath = join(REPO_ROOT, 'agents', agent, 'bakin-package.json')
    if (!existsSync(pkgPath)) {
      console.error(`Package source missing: ${pkgPath}`)
      console.error(`Cannot continue. Each requested agent must have a package under ${join(REPO_ROOT, 'agents')}/.`)
      process.exit(2)
    }
  }
}

function wipeAgent(agent: string): StepResult {
  try {
    const out = execFileSync(
      'openclaw',
      ['agents', 'delete', agent, '--force', '--json'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ).toString('utf-8')
    return { agent, step: 'wipe', status: 'ok', message: out.trim() || 'deleted' }
  } catch (err) {
    const message = (err as { stderr?: Buffer; message?: string }).stderr?.toString().trim()
      || (err as Error).message
    // "not found" is fine — the agent was already absent (or this is a re-run).
    if (/not found|does not exist/i.test(message)) {
      return { agent, step: 'wipe', status: 'skipped', message: 'agent absent (re-run)' }
    }
    return { agent, step: 'wipe', status: 'failed', message }
  }
}

async function installAgent(
  agent: string,
  installPackage: (opts: { source: string }) => Promise<{ packageId: string; kind: string; createdAgent: boolean }>,
): Promise<StepResult> {
  const src = join(REPO_ROOT, 'agents', agent)
  try {
    const result = await installPackage({ source: src })
    return {
      agent,
      step: 'install',
      status: 'ok',
      message: `${result.packageId} (${result.kind})`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { agent, step: 'install', status: 'failed', message }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const agents = argv.length > 0 ? argv : Array.from(DEFAULT_AGENTS)

  console.log(`Wipe + fresh-install for ${agents.length} agent(s):`)
  console.log(`  ${agents.join(', ')}\n`)

  checkOpenClawCli()
  checkPackagesExist(agents)

  // Lazy import — installer pulls the openclaw-adapter at module-top, which
  // resolves OPENCLAW_HOME. Default behavior (real ~/.openclaw/) is what we
  // want here; the test-env safety guard only fires under NODE_ENV=test.
  const { installPackage } = await import('../../src/core/agent-packages/installer')

  const results: StepResult[] = []

  // Phase 1: wipe.
  console.log('─── Phase 1: wipe agents from OpenClaw ───────────────────────────')
  for (const agent of agents) {
    process.stdout.write(`  ${agent.padEnd(20)} `)
    const result = wipeAgent(agent)
    results.push(result)
    if (result.status === 'ok') process.stdout.write('✓ removed\n')
    else if (result.status === 'skipped') process.stdout.write(`· ${result.message}\n`)
    else process.stdout.write(`✗ ${result.message}\n`)
  }

  // Phase 2: fresh install.
  console.log('\n─── Phase 2: fresh install from package source ──────────────────')
  for (const agent of agents) {
    process.stdout.write(`  ${agent.padEnd(20)} `)
    const result = await installAgent(agent, installPackage)
    results.push(result)
    if (result.status === 'ok') process.stdout.write(`✓ installed (${result.message})\n`)
    else process.stdout.write(`✗ ${result.message}\n`)
  }

  // Summary.
  const failed = results.filter((r) => r.status === 'failed')
  console.log('\n─── Summary ──────────────────────────────────────────────────────')
  console.log(`  wiped:     ${results.filter((r) => r.step === 'wipe' && r.status === 'ok').length}`)
  console.log(`  skipped:   ${results.filter((r) => r.step === 'wipe' && r.status === 'skipped').length}`)
  console.log(`  installed: ${results.filter((r) => r.step === 'install' && r.status === 'ok').length}`)
  console.log(`  failed:    ${failed.length}`)

  if (failed.length > 0) {
    console.log('\nFailures:')
    for (const f of failed) {
      console.log(`  - ${f.agent} (${f.step}): ${f.message}`)
    }
    process.exit(1)
  }

  console.log('\nNext steps:')
  console.log('  bakin agents list --packages   # verify all show as managed')
  console.log('  bakin doctor                    # repair any drift')
  console.log('  bakin restart                    # if Bakin was running, restart so the')
  console.log('                                   # workflow source registry loads the new')
  console.log('                                   # packages from the lockfile')
}

void dirname

if (import.meta.main) {
  main().catch((err) => {
    console.error('\nFatal:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
