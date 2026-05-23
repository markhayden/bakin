/**
 * Lifecycle orchestration for the OpenClaw dev rig: preflight, up, reset, down,
 * status. Pure argv builders + an orchestrator driven by injected deps (runner,
 * rmrf, sleep, log, env) so call-ordering and reset-scoping are unit-testable
 * without Docker, op, or the filesystem.
 *
 * Boundary: dev-rig module, exempt from provider-boundary rules
 * (see tests/architecture/adapter-boundary.test.ts).
 */
import { join } from 'node:path'

import { ensureCodexAuth, type OpenClawExec } from './codex'
import { buildConfigCommands } from './openclaw-config'
import { parseSecretsTemplate, redactSecrets, resolveSecrets } from './op-resolve'
import { bakinOnboardArgs, sandboxBakinArgs, sandboxExecArgs } from './sandbox'
import type { InstancePaths } from './paths'
import type { InstancePlan } from './modes'
import type { CommandRunner } from './runner'

const GATEWAY_HEALTH_URL = 'http://127.0.0.1:18789/healthz'
const HEALTH_RETRIES = 30

export interface LifecycleDeps {
  runner: CommandRunner
  rmrf: (path: string) => Promise<void>
  mkdirp: (path: string) => Promise<void>
  exists: (path: string) => boolean
  sleep: (ms: number) => Promise<void>
  log: (message: string) => void
  env: Record<string, string | undefined>
}

// ── Pure argv builders ───────────────────────────────────────────────────────

export function composeUpArgs(composeFile: string, services: string[], profile: string | null): string[] {
  const profileFlag = profile ? ['--profile', profile] : []
  return ['docker', 'compose', ...profileFlag, '-f', composeFile, 'up', '-d', ...services]
}

export function composeDownArgs(composeFile: string): string[] {
  return ['docker', 'compose', '-f', composeFile, 'down']
}

/** Run a non-interactive OpenClaw CLI command through the cli service (-T). */
export function openclawExecArgs(composeFile: string, openclawArgs: string[]): string[] {
  return ['docker', 'compose', '-f', composeFile, 'run', '--rm', '-T', 'openclaw-cli', ...openclawArgs]
}

/**
 * Interactive codex OAuth needs the 1455 callback port published, which the
 * cli service can't do (it shares the gateway's network). Use a dedicated
 * `docker run -it -p 1455:1455 -v <home>` — the path proven in setup.sh.
 */
export function codexAuthRunArgs(image: string, openclawHome: string, openclawArgs: string[]): string[] {
  return [
    'docker', 'run', '--rm', '-it', '-p', '1455:1455',
    '-v', `${openclawHome}:/home/node/.openclaw`,
    '--entrypoint', 'node', image,
    'dist/index.js', ...openclawArgs,
  ]
}

/**
 * One-off init that writes a baseline openclaw.json (gateway.mode=local) into
 * the mounted home. The gateway exits with "Missing config" on an empty home,
 * so this must run BEFORE bringing the gateway up on a fresh home. Auth is
 * skipped here (codex is handled separately); --skip-health avoids probing a
 * gateway that isn't up yet.
 */
export function initRunArgs(image: string, openclawHome: string): string[] {
  return [
    'docker', 'run', '--rm',
    '-v', `${openclawHome}:/home/node/.openclaw`,
    '--entrypoint', 'node', image,
    'dist/index.js', 'onboard',
    '--non-interactive', '--accept-risk', '--mode', 'local', '--auth-choice', 'skip', '--skip-health',
  ]
}

function openclawImage(deps: LifecycleDeps): string {
  return `ghcr.io/openclaw/openclaw:${deps.env.OPENCLAW_IMAGE_TAG || 'latest'}`
}

function healthCheckArgs(): string[] {
  return ['curl', '-sf', GATEWAY_HEALTH_URL]
}

// ── Orchestration ─────────────────────────────────────────────────────────────

export async function preflight(deps: LifecycleDeps): Promise<void> {
  const docker = await deps.runner.run(['docker', 'info'])
  if (docker.code !== 0) {
    throw new Error('Docker is not running. Start Docker Desktop (or OrbStack) and retry.')
  }
  const op = await deps.runner.run(['op', '--version'])
  if (op.code !== 0) {
    throw new Error('1Password CLI `op` not found. Install it: https://developer.1password.com/docs/cli/get-started')
  }
  if (!deps.env.OP_SERVICE_ACCOUNT_TOKEN) {
    throw new Error('OP_SERVICE_ACCOUNT_TOKEN is not set. Export your 1Password service-account token and retry.')
  }
}

function makeOpenClawExec(
  plan: InstancePlan,
  paths: InstancePaths,
  deps: LifecycleDeps,
  secretsEnv: Record<string, string>,
): OpenClawExec {
  // Sandbox: OpenClaw runs in the sandbox container (codex OAuth on the
  // published 1455 port); exec into it for both config and interactive auth.
  if (plan.bakin.placement === 'container') {
    return (args, opts) =>
      deps.runner.run(sandboxExecArgs(paths.composeFile, args, !!opts?.interactive), {
        interactive: opts?.interactive,
        env: secretsEnv,
      })
  }
  // native/isolated: cli service for config; dedicated docker-run for codex OAuth.
  return (args, opts) =>
    opts?.interactive
      ? deps.runner.run(codexAuthRunArgs(openclawImage(deps), paths.openclawHome, args), { interactive: true })
      : deps.runner.run(openclawExecArgs(paths.composeFile, args), { env: secretsEnv })
}

async function waitForGatewayHealthy(deps: LifecycleDeps, paths: InstancePaths): Promise<void> {
  for (let i = 0; i < HEALTH_RETRIES; i++) {
    const result = await deps.runner.run(healthCheckArgs())
    if (result.code === 0) return
    await deps.sleep(1000)
  }
  throw new Error(`OpenClaw gateway did not become healthy. Inspect: docker compose -f ${paths.composeFile} logs`)
}

export async function up(
  plan: InstancePlan,
  paths: InstancePaths,
  secretTemplateText: string,
  deps: LifecycleDeps,
): Promise<void> {
  await preflight(deps)

  if (plan.wipeBeforeUp.length > 0) {
    // Stop containers FIRST so they release the bind mount; wiping a mounted
    // dir leaves the container pointing at a deleted inode (ENOENT on writes).
    await deps.runner.run(composeDownArgs(paths.composeFile))
    for (const dir of plan.wipeBeforeUp) {
      deps.log(`wiping ${dir}`)
      await deps.rmrf(dir)
    }
  }
  // Ensure the bind-mount target exists as a real, host-owned dir.
  await deps.mkdirp(paths.openclawHome)

  // Resolve secrets host-side; only resolved values flow onward (D4).
  const refs = parseSecretsTemplate(secretTemplateText)
  const secrets = await resolveSecrets(refs, deps.runner)
  const secretValues = Object.values(secrets)

  // The gateway exits on an empty home ("Missing config"), so initialize a
  // baseline openclaw.json via a one-off container before bringing it up.
  if (!deps.exists(join(paths.openclawHome, 'openclaw.json'))) {
    deps.log('initializing OpenClaw config…')
    const init = await deps.runner.run(initRunArgs(openclawImage(deps), paths.openclawHome))
    if (init.code !== 0) {
      throw new Error(`OpenClaw config init failed: ${init.stderr.trim() || `exit ${init.code}`}`)
    }
  }

  deps.log('starting OpenClaw container…')
  const upResult = await deps.runner.run(
    composeUpArgs(paths.composeFile, plan.services, plan.composeProfile),
    { env: secrets },
  )
  if (upResult.code !== 0) {
    throw new Error(`docker compose up failed: ${upResult.stderr.trim() || `exit ${upResult.code}`}`)
  }

  await waitForGatewayHealthy(deps, paths)

  // Configure exclusively via the OpenClaw CLI (D10).
  const exec = makeOpenClawExec(plan, paths, deps, secrets)
  const configCommands = buildConfigCommands({ braveApiKey: secrets.BRAVE_API_KEY })
  for (const command of configCommands) {
    deps.log(redactSecrets(`config: openclaw ${command.join(' ')}`, secretValues))
    const result = await exec(command)
    if (result.code !== 0) {
      throw new Error(
        `openclaw ${command[0]} ${command[1]} failed: ${redactSecrets(result.stderr.trim(), secretValues) || `exit ${result.code}`}`,
      )
    }
  }

  // Codex: fresh browser OAuth if the mounted home has no codex profile (D3).
  const codex = await ensureCodexAuth(exec)
  deps.log(codex.alreadyAuthed ? 'codex: already authed' : 'codex: completed browser OAuth')

  if (plan.bakin.placement === 'container') {
    if (plan.bakin.onboard === 'auto') {
      deps.log('sandbox: onboarding Bakin (--preconfigure)…')
      const onboard = await deps.runner.run(
        sandboxBakinArgs(paths.composeFile, plan.bakin.source, bakinOnboardArgs(), false),
        { env: secrets },
      )
      if (onboard.code !== 0) {
        throw new Error(`bakin onboard failed in sandbox: ${onboard.stderr.trim() || `exit ${onboard.code}`}`)
      }
    } else {
      deps.log('sandbox: Bakin not onboarded (manual). Run `instance shell` then `bakin onboard`.')
    }
  }
}

export async function reset(plan: InstancePlan, paths: InstancePaths, deps: LifecycleDeps): Promise<void> {
  await deps.runner.run(composeDownArgs(paths.composeFile))
  for (const dir of paths.resetTargets) {
    deps.log(`wiping ${dir}`)
    await deps.rmrf(dir)
  }
}

export async function down(paths: InstancePaths, deps: LifecycleDeps): Promise<void> {
  await deps.runner.run(composeDownArgs(paths.composeFile))
}
