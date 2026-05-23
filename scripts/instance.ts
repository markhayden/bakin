#!/usr/bin/env bun
/**
 * Disposable Dockerized OpenClaw dev/onboarding rig.
 *
 * One command spins up a fresh, fully-configured OpenClaw container so Bakin
 * can be developed on this machine without contaminating the host's ~/.openclaw,
 * and so Bakin's onboarding can be exercised against a clean slate on demand.
 *
 * Modes (the container is identical across all three; they differ only in
 * where/how Bakin runs):
 *   native    OpenClaw in container; Bakin runs from this repo on the host.
 *   isolated  like native, but Bakin uses a throwaway BAKIN_HOME under dev/.
 *   sandbox   Bakin runs inside the container (clean Linux box).
 *
 * See SPEC.md / tasks/plan.md. Dispatch is wired incrementally (T5/T6/T7).
 */
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parseInstanceArgs, type InstanceArgs } from './instance/args'
import { loadEnvFile } from './instance/env-file'
import { down, reset, up, type LifecycleDeps } from './instance/lifecycle'
import { resolvePlan } from './instance/modes'
import { instancePaths, type InstancePaths } from './instance/paths'
import { bunRunner } from './instance/runner'
import { sandboxBakinArgs, sandboxShellArgs } from './instance/sandbox'

const REPO_ROOT = resolve(import.meta.dir, '..')

const USAGE = `Usage: bun run instance <verb> [flags]

Verbs:
  up        Bring up the configured OpenClaw container (and Bakin per --mode)
  reset     Wipe instance state (openclaw-home + throwaway BAKIN_HOME) and recreate
  down      Stop the containers
  shell     Open a shell into the container / print the host env for native
  status    Report container health, configured providers/tools, and auth state
  env       Print the environment this instance exports
  run -- <args...>   Run an arbitrary bakin/openclaw command in this instance's context

Flags:
  --mode native|isolated|sandbox   Where/how Bakin runs (default: native)
  --fresh                          Wipe instance state before bringing it up
  --source repo|installed          Bakin source for isolated/sandbox (default: repo)
  --preconfigure                   Sandbox only: auto-run \`bakin onboard --yes\`

Prerequisites: Docker running, \`op\` CLI installed, OP_SERVICE_ACCOUNT_TOKEN set.`

function makeDeps(): LifecycleDeps {
  return {
    runner: bunRunner,
    rmrf: (path) => rm(path, { recursive: true, force: true }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (message) => console.log(`▸ ${message}`),
    env: process.env,
  }
}

function printEnv(paths: InstancePaths, hostEnv: Record<string, string>): void {
  console.log(`BAKIN_HOME=${hostEnv.BAKIN_HOME ?? '(default ~/.bakin)'}`)
  for (const [key, value] of Object.entries(hostEnv)) {
    if (key !== 'BAKIN_HOME') console.log(`${key}=${value}`)
  }
  console.log(`# openclaw-home: ${paths.openclawHome}`)
}

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(USAGE)
    return argv.length === 0 ? 1 : 0
  }

  let args: InstanceArgs
  try {
    args = parseInstanceArgs(argv)
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    console.error(USAGE)
    return 1
  }

  const paths = instancePaths(REPO_ROOT, args.mode)
  const plan = resolvePlan(args, paths)
  // Load host-side rig env (OP_SERVICE_ACCOUNT_TOKEN, OPENCLAW_IMAGE_TAG) from
  // the gitignored dev/docker/.env; real shell exports still win.
  loadEnvFile(resolve(REPO_ROOT, 'dev/docker/.env'), process.env)
  const deps = makeDeps()

  try {
    switch (args.verb) {
      case 'up': {
        const template = readFileSync(paths.secretsTemplate, 'utf-8')
        await up(plan, paths, template, deps)
        console.log('\n✓ OpenClaw instance ready.')
        if (plan.bakin.placement === 'host') {
          console.log('Run Bakin against it with:')
          printEnv(paths, plan.hostEnv)
        }
        return 0
      }
      case 'reset':
        await reset(plan, paths, deps)
        console.log('✓ instance reset')
        return 0
      case 'down':
        await down(paths, deps)
        console.log('✓ containers stopped')
        return 0
      case 'env':
        printEnv(paths, plan.hostEnv)
        return 0
      case 'status': {
        const ps = await deps.runner.run(['docker', 'compose', '-f', paths.composeFile, 'ps'])
        process.stdout.write(ps.stdout)
        return ps.code
      }
      case 'shell': {
        if (plan.bakin.placement !== 'container') {
          console.log('# native/isolated: run Bakin on the host with this env:')
          printEnv(paths, plan.hostEnv)
          return 0
        }
        const shell = await deps.runner.run(sandboxShellArgs(paths.composeFile), { interactive: true })
        return shell.code
      }
      case 'run': {
        if (plan.bakin.placement !== 'container') {
          console.error('run is only supported in --mode sandbox; for native/isolated use the printed env with the bakin CLI.')
          return 1
        }
        const ran = await deps.runner.run(
          sandboxBakinArgs(paths.composeFile, plan.bakin.source, args.rest, true),
          { interactive: true },
        )
        return ran.code
      }
    }
  } catch (err) {
    console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}

export { main }
