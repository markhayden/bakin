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
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { getContentDir } from '../packages/core/src/content-dir'
import {
  antflyBinary,
  antflyModelsDir,
  startAntflyChild,
  type AntflyChildDeps,
} from './instance/antfly-child'
import { parseInstanceArgs, type InstanceArgs } from './instance/args'
import { ensureApprovedDevice } from './instance/device-approve'
import { loadEnvFile } from './instance/env-file'
import { applySettingsPatch, down, reset, up, type LifecycleDeps } from './instance/lifecycle'
import { resolvePlan, type InstancePlan } from './instance/modes'
import { instancePaths, type InstancePaths } from './instance/paths'
import { PI_CLI_ENTRY, piAuthFile } from './instance/pi'
import { bunRunner } from './instance/runner'
import { sandboxBakinArgs, sandboxShellArgs, type SandboxService } from './instance/sandbox'

const REPO_ROOT = resolve(import.meta.dir, '..')

const USAGE = `Usage: bun run instance <verb> [flags]

Provision:
  up        Bring up the instance's runtime — openclaw: configured gateway
            container; pi: throwaway pi home + interactive /login

Run + access (after \`up\`):
  dev       Run Bakin (hot reload) against the instance → http://localhost:3737
            (native/isolated; onboards the home first if needed)
  run -- <args...>   Run a Bakin CLI command in this instance's context
  shell     Drop into a shell with the instance env set (sandbox: into the container)
  status    Report instance health (containers, or pi auth/server state)
  env       Print the environment this instance exports

Teardown:
  down      Stop the containers (state is preserved)
  reset     Stop + wipe instance state for the mode — BOTH runtimes' homes

Flags:
  --mode native|isolated|sandbox   Where/how Bakin runs (default: native)
  --runtime openclaw|pi            Agent runtime for this instance (default: openclaw)
  --fresh                          Wipe instance state before bringing it up
  --source repo|installed          Bakin source for isolated/sandbox (default: repo)
  --preconfigure                   Sandbox+openclaw only: auto-run \`bakin onboard --yes\`

OpenClaw CLI access: ./dev/docker/openclaw-shim.sh <args>   (e.g. mcp list)
Full image cleanup:  docker compose -f dev/docker/docker-compose.yml --profile sandbox down --rmi local

Prerequisites (openclaw): Docker running, \`op\` CLI installed, OP_SERVICE_ACCOUNT_TOKEN (in dev/docker/.env or env).
Prerequisites (pi):       none — the pinned SDK ships the pi CLI; /login runs in your terminal.`

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
    piDefaultModels: async () => {
      try {
        // The SDK is a workspace dep of adapter-pi (not hoisted to the root),
        // so resolve it by path. Its per-provider defaults table saves the rig
        // from maintaining a drift-prone model map of its own.
        const mod = await import(`../${PI_CLI_ENTRY.replace('cli.js', 'core/model-resolver.js')}`) as {
          defaultModelPerProvider?: Record<string, string>
        }
        return mod.defaultModelPerProvider ?? null
      } catch {
        return null
      }
    },
  }
}

/** Real-process deps for the rig antfly child (engine output → <dataDir>.log). */
function antflyChildDeps(): AntflyChildDeps {
  return {
    spawn: (argv) => {
      const logFd = openSync(`${argv[argv.indexOf('--data-dir') + 1]}.log`, 'a')
      const child = spawn(argv[0]!, argv.slice(1), { stdio: ['ignore', logFd, logFd] })
      return {
        kill: (signal) => { child.kill(signal as NodeJS.Signals) },
        exited: new Promise<number>((r) => child.once('exit', (code) => r(code ?? 1))),
      }
    },
    fetchOk: async (url) => {
      try {
        const res = await fetch(url)
        return res.ok || res.status < 500
      } catch {
        return false
      }
    },
    mkdirp: async (path) => { await mkdir(path, { recursive: true }) },
    exists: (path) => existsSync(path),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (message) => console.log(`▸ ${message}`),
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

function printEnv(paths: InstancePaths, plan: InstancePlan): void {
  console.log(`BAKIN_HOME=${plan.hostEnv.BAKIN_HOME ?? '(default ~/.bakin)'}`)
  for (const [key, value] of Object.entries(plan.hostEnv)) {
    if (key !== 'BAKIN_HOME') console.log(`${key}=${value}`)
  }
  if (plan.runtime === 'pi') console.log(`# pi-home: ${paths.piHome}`)
  else console.log(`# openclaw-home: ${paths.openclawHome}`)
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
        // Secrets (op://) are an openclaw concern — pi needs no template.
        const template = plan.runtime === 'openclaw' ? readFileSync(paths.secretsTemplate, 'utf-8') : ''
        await up(plan, paths, template, deps)
        console.log(`\n✓ ${plan.runtime === 'pi' ? 'Pi' : 'OpenClaw'} instance ready.`)
        if (plan.bakin.placement === 'host') {
          console.log('Run Bakin against it with:')
          printEnv(paths, plan)
        }
        return 0
      }
      case 'dev': {
        if (plan.bakin.placement === 'container') {
          console.error('`dev` runs Bakin on the host — use --mode native or isolated. For sandbox, use `instance shell` then `bun run server.ts serve`.')
          return 1
        }
        if (plan.runtime === 'openclaw') {
          const health = await deps.runner.run(['curl', '-sf', 'http://127.0.0.1:18789/healthz'])
          if (health.code !== 0) {
            console.error('OpenClaw gateway is not reachable — run `instance up` first.')
            return 1
          }
        } else if (!existsSync(piAuthFile(paths.piHome))) {
          console.error('Pi is not authed for this instance — run `instance up --runtime pi` first.')
          return 1
        }
        // native mode intentionally uses the real home (getContentDir() resolves
        // BAKIN_HOME→~/.bakin); isolated mode sets a throwaway BAKIN_HOME on
        // hostEnv. This is the one spot the rig touches the real home — only
        // reads/onboards it; reset/wipe never reach here.
        const bakinHome = plan.hostEnv.BAKIN_HOME ?? getContentDir()
        if (!existsSync(join(bakinHome, '.onboarded'))) {
          console.log('▸ onboarding Bakin home against the instance…')
          const onboard = await deps.runner.run(
            ['bun', 'run', 'cli/bakin.ts', 'onboard', '--yes'],
            { interactive: true, env: plan.hostEnv, cwd: REPO_ROOT },
          )
          if (onboard.code !== 0) return onboard.code
          // Onboarding may rewrite the throwaway settings.json — re-apply the
          // guard patch (guest search URL + adapter) before the server boots.
          await applySettingsPatch(plan, paths, deps)
        }
        // Isolated mode: the instance's own antfly child (guest-URL settings
        // keep the adapter from ever touching the machine-global service).
        // Lives exactly as long as the server; killed in finally.
        let antfly: { stop: () => Promise<void> } | null = null
        if (plan.antflyChild) {
          antfly = await startAntflyChild(
            {
              binary: antflyBinary(process.env, homedir()),
              port: plan.antflyChild.port,
              dataDir: plan.antflyChild.dataDir,
              modelsDir: antflyModelsDir(process.env, homedir()),
            },
            antflyChildDeps(),
          )
        }
        try {
          console.log('▸ starting Bakin (hot reload) → http://localhost:3737  (Ctrl+C to stop)')
          // scripts/dev.ts is env-driven (it reads BAKIN_HOME/OPENCLAW_HOME/
          // PI_HOME/… from process.env and imports the server in-process), so
          // the rig env flows straight through — and the browser gets real HMR.
          const server = await deps.runner.run(
            ['bun', 'run', 'scripts/dev.ts'],
            { interactive: true, env: plan.hostEnv, cwd: REPO_ROOT },
          )
          return server.code
        } finally {
          await antfly?.stop()
        }
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
        printEnv(paths, plan)
        return 0
      case 'status': {
        if (plan.docker) {
          const ps = await deps.runner.run(['docker', 'compose', '-f', paths.composeFile, 'ps'])
          process.stdout.write(ps.stdout)
          return ps.code
        }
        // pi host modes: no containers — report local instance state.
        const authed = existsSync(piAuthFile(paths.piHome))
        const server = await deps.runner.run(['curl', '-sf', 'http://localhost:3737/api/agents/health'])
        console.log(`pi-home:   ${paths.piHome}`)
        console.log(`pi auth:   ${authed ? 'authed' : 'missing (run `instance up --runtime pi`)'}`)
        console.log(`server:    ${server.code === 0 ? 'running → http://localhost:3737' : 'not running (instance dev --runtime pi)'}`)
        return 0
      }
      case 'shell': {
        if (plan.bakin.placement === 'container') {
          const service = plan.docker!.services[0] as SandboxService
          const shell = await deps.runner.run(sandboxShellArgs(paths.composeFile, service), { interactive: true })
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
          const service = plan.docker!.services[0] as SandboxService
          const ran = await deps.runner.run(
            sandboxBakinArgs(paths.composeFile, plan.bakin.source, args.rest, true, service),
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
