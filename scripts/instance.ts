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
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { getContentDir } from '../packages/core/src/content-dir'
import { parseInstanceArgs, type InstanceArgs } from './instance/args'
import { ensureApprovedDevice } from './instance/device-approve'
import { loadEnvFile } from './instance/env-file'
import { down, reset, up, type LifecycleDeps } from './instance/lifecycle'
import { resolvePlan } from './instance/modes'
import { instancePaths, type InstancePaths } from './instance/paths'
import { bunRunner } from './instance/runner'
import { sandboxBakinArgs, sandboxShellArgs } from './instance/sandbox'

const REPO_ROOT = resolve(import.meta.dir, '..')

const USAGE = `Usage: bun run instance <verb> [flags]

Provision:
  up        Bring up the configured OpenClaw container (and Bakin per --mode)

Run + access (after \`up\`):
  dev       Run Bakin against the instance → UI at http://localhost:3737
            (native/isolated; onboards the home first if needed)
  run -- <args...>   Run a Bakin CLI command in this instance's context
  shell     Drop into a shell with the instance env set (sandbox: into the container)
  status    Report container health and configured services
  env       Print the environment this instance exports

Teardown:
  down      Stop the containers (state is preserved)
  reset     Stop + wipe instance state (openclaw-home + throwaway BAKIN_HOME)

Flags:
  --mode native|isolated|sandbox   Where/how Bakin runs (default: native)
  --fresh                          Wipe instance state before bringing it up
  --source repo|installed          Bakin source for isolated/sandbox (default: repo)
  --preconfigure                   Sandbox only: auto-run \`bakin onboard --yes\`

OpenClaw CLI access: ./dev/docker/openclaw-shim.sh <args>   (e.g. mcp list)
Full image cleanup:  docker compose -f dev/docker/docker-compose.yml --profile sandbox down --rmi local

Prerequisites: Docker running, \`op\` CLI installed, OP_SERVICE_ACCOUNT_TOKEN (in dev/docker/.env or env).`

function makeDeps(paths: InstancePaths): LifecycleDeps {
  return {
    runner: bunRunner,
    emptyDir: async (path) => {
      // Wipe contents, keep the dir inode stable (Docker bind-mount cache).
      let entries: string[]
      try {
        entries = await readdir(path)
      } catch {
        return // dir doesn't exist yet — nothing to empty
      }
      await Promise.all(entries.map((entry) => rm(join(path, entry), { recursive: true, force: true })))
    },
    mkdirp: async (path) => { await mkdir(path, { recursive: true }) },
    exists: (path) => existsSync(path),
    ensureDevice: () => {
      ensureApprovedDevice(paths.openclawHome, Date.now(), `bakin-dev-${randomUUID()}`)
    },
    readTextFile: (path) => readFileSync(path, 'utf-8'),
    writeTextFile: (path, content) => { writeFileSync(path, content) },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (message) => console.log(`▸ ${message}`),
    env: process.env,
  }
}

/**
 * Env for a host-run Bakin CLI / subshell. The CLI is a client of the server,
 * so BAKIN_URL must point at localhost — not the host.docker.internal callback
 * URL (which only resolves inside the OpenClaw container).
 */
function hostCliEnv(hostEnv: Record<string, string>): Record<string, string> {
  return { ...hostEnv, BAKIN_URL: 'http://localhost:3737' }
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
  const deps = makeDeps(paths)

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
      case 'dev': {
        if (plan.bakin.placement === 'container') {
          console.error('`dev` runs Bakin on the host — use --mode native or isolated. For sandbox, use `instance shell` then `bun run server.ts serve`.')
          return 1
        }
        const health = await deps.runner.run(['curl', '-sf', 'http://127.0.0.1:18789/healthz'])
        if (health.code !== 0) {
          console.error('OpenClaw gateway is not reachable — run `instance up` first.')
          return 1
        }
        // native mode intentionally uses the real home (getContentDir() resolves
        // BAKIN_HOME→~/.bakin); isolated mode sets a throwaway BAKIN_HOME on
        // hostEnv. This is the one spot the rig touches the real home — only
        // reads/onboards it; reset/wipe never reach here.
        const bakinHome = plan.hostEnv.BAKIN_HOME ?? getContentDir()
        if (!existsSync(join(bakinHome, '.onboarded'))) {
          console.log('▸ onboarding Bakin home against the container…')
          const onboard = await deps.runner.run(
            ['bun', 'run', 'cli/bakin.ts', 'onboard', '--yes'],
            { interactive: true, env: plan.hostEnv, cwd: REPO_ROOT },
          )
          if (onboard.code !== 0) return onboard.code
        }
        console.log('▸ starting Bakin → http://localhost:3737  (Ctrl+C to stop)')
        // `serve` is required: a bare `bun run server.ts` defaults to `help`
        // since 6e36a4d8 (same reason scripts/dev.ts splices in 'serve').
        const server = await deps.runner.run(
          ['bun', 'run', 'server.ts', 'serve'],
          { interactive: true, env: plan.hostEnv, cwd: REPO_ROOT },
        )
        return server.code
      }
      case 'reset':
        await reset(plan, paths, deps)
        console.log('✓ instance reset (state wiped)')
        return 0
      case 'down':
        await down(paths, deps)
        console.log('✓ containers stopped (state preserved; `reset` to wipe, `down --rmi local` via docker to remove images)')
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
        if (plan.bakin.placement === 'container') {
          const shell = await deps.runner.run(sandboxShellArgs(paths.composeFile), { interactive: true })
          return shell.code
        }
        console.log('# subshell with instance env. Bakin CLI: `bun run cli/bakin.ts …`  ·  OpenClaw CLI: `./dev/docker/openclaw-shim.sh …`  ·  `exit` to leave.')
        const shell = await deps.runner.run([process.env.SHELL || '/bin/bash'], {
          interactive: true,
          env: hostCliEnv(plan.hostEnv),
          cwd: REPO_ROOT,
        })
        return shell.code
      }
      case 'run': {
        if (plan.bakin.placement === 'container') {
          const ran = await deps.runner.run(
            sandboxBakinArgs(paths.composeFile, plan.bakin.source, args.rest, true),
            { interactive: true },
          )
          return ran.code
        }
        // native/isolated: Bakin CLI on the host. The CLI is a host client of the
        // server, so it reaches it on localhost — not the host.docker.internal
        // callback URL (which only resolves inside the container).
        const ran = await deps.runner.run(
          ['bun', 'run', 'cli/bakin.ts', ...args.rest],
          { interactive: true, env: hostCliEnv(plan.hostEnv), cwd: REPO_ROOT },
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
