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
import { resolve } from 'node:path'

import { parseInstanceArgs, VERBS, type InstanceArgs } from './instance/args'
import { instancePaths } from './instance/paths'

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

function main(argv: string[]): number {
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

  // Lifecycle dispatch is implemented in T5–T7. For now, surface the resolved
  // plan so the entrypoint + arg parsing are exercisable end-to-end.
  const paths = instancePaths(REPO_ROOT, args.mode)
  console.log(`resolved: verb=${args.verb} mode=${args.mode} fresh=${args.fresh} source=${args.source} preconfigure=${args.preconfigure}`)
  console.log(`openclaw-home: ${paths.openclawHome}`)
  console.log(`(lifecycle dispatch lands in T5–T7; verbs known: ${VERBS.join(', ')})`)
  return 0
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)))
}

export { main }
