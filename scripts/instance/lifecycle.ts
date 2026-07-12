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

import {
  CODEX_CLI_ENTRY,
  CODEX_DEFAULT_MODEL,
  CODEX_HOME_CONTAINER,
  codexAuthFile,
  codexLoginArgs,
  type OpenClawExec,
} from './codex'
import { normalizeAgentPaths } from './agent-paths'
import { buildConfigCommands } from './openclaw-config'
import { parseSecretsTemplate, redactSecrets, resolveSecrets } from './op-resolve'
import {
  defaultModelFromAuth,
  patchPiSettings,
  piAgentDir,
  piAuthFile,
  piLoginArgs,
  piLoginEnv,
  piSettingsFile,
  sandboxPiLoginArgs,
} from './pi'
import { bakinOnboardArgs, sandboxBakinArgs, sandboxExecArgs } from './sandbox'
import { mergeThrowawaySettings } from './throwaway-settings'
import type { InstancePaths } from './paths'
import type { InstancePlan } from './modes'
import type { CommandRunner } from './runner'

const GATEWAY_HEALTH_URL = 'http://127.0.0.1:18789/healthz'
const HEALTH_RETRIES = 60 // ~60s; cold first boot inits workspace/sessions before listening

export interface LifecycleDeps {
  runner: CommandRunner
  /**
   * Wipe a directory's CONTENTS in place, keeping the directory itself.
   * Deleting + recreating a bind-mounted dir swaps its inode and poisons
   * Docker Desktop's file-sharing cache (container sees an empty/stale mount).
   */
  emptyDir: (path: string) => Promise<void>
  mkdirp: (path: string) => Promise<void>
  exists: (path: string) => boolean
  /** Pre-approve Bakin's gateway device so operator.write is granted (no-op if already set up). */
  ensureDevice: () => void
  readTextFile: (path: string) => string
  writeTextFile: (path: string, content: string) => void
  sleep: (ms: number) => Promise<void>
  log: (message: string) => void
  env: Record<string, string | undefined>
  /**
   * The pinned Pi SDK's defaultModelPerProvider table, or null when
   * unavailable — the pi default-model step warn-don't-fails on null.
   */
  piDefaultModels: () => Promise<Record<string, string> | null>
}

// ── Pure argv builders ───────────────────────────────────────────────────────

export function composeUpArgs(composeFile: string, services: string[], profile: string | null): string[] {
  const profileFlag = profile ? ['--profile', profile] : []
  return ['docker', 'compose', ...profileFlag, '-f', composeFile, 'up', '-d', ...services]
}

export function composeDownArgs(composeFile: string): string[] {
  return ['docker', 'compose', '-f', composeFile, 'down']
}

export function composeRestartArgs(composeFile: string, services: string[], profile: string | null): string[] {
  const profileFlag = profile ? ['--profile', profile] : []
  return ['docker', 'compose', ...profileFlag, '-f', composeFile, 'restart', ...services]
}

/** Run a non-interactive OpenClaw CLI command through the cli service (-T). */
export function openclawExecArgs(composeFile: string, openclawArgs: string[]): string[] {
  return ['docker', 'compose', '-f', composeFile, 'run', '--rm', '-T', 'openclaw-cli', ...openclawArgs]
}

/**
 * Interactive Codex CLI login (ChatGPT device-code OAuth). No port publish: the
 * device-code flow polls outbound, so unlike the browser-callback flow it needs
 * no inbound localhost callback. CODEX_HOME is kept inside the mounted home so
 * the credential persists and the gateway reads it.
 */
export function codexLoginRunArgs(image: string, openclawHome: string): string[] {
  return [
    'docker', 'run', '--rm', '-it',
    '-e', `CODEX_HOME=${CODEX_HOME_CONTAINER}`,
    '-v', `${openclawHome}:/home/node/.openclaw`,
    '--entrypoint', 'node', image,
    CODEX_CLI_ENTRY, ...codexLoginArgs(),
  ]
}

/**
 * Sandbox: the gateway (and its 1455 publish + CODEX_HOME env) already run in the
 * sandbox container, so exec the Codex CLI login into it rather than a one-off.
 */
export function codexLoginExecArgs(composeFile: string, service: string): string[] {
  return ['docker', 'compose', '-f', composeFile, 'exec', service, 'node', CODEX_CLI_ENTRY, ...codexLoginArgs()]
}

/** A non-interactive one-off OpenClaw CLI run against the mounted home (gateway not yet up). */
export function oneOffRunArgs(image: string, openclawHome: string, openclawArgs: string[]): string[] {
  return [
    'docker', 'run', '--rm',
    '-v', `${openclawHome}:/home/node/.openclaw`,
    '--entrypoint', 'node', image,
    'dist/index.js', ...openclawArgs,
  ]
}

/**
 * Fixed gateway token for the loopback dev rig. The gateway publishes only to
 * 127.0.0.1, single-user, so a fixed token is fine — and pinning auth.token ==
 * remote.token lets the local CLI connect (onboard otherwise generates a random
 * auth.token with no matching remote.token → "gateway token mismatch").
 */
const GATEWAY_DEV_TOKEN = 'bakin-local-dev'

/**
 * OpenClaw CLI commands that bootstrap a fresh home, run as one-offs BEFORE the
 * gateway starts (it exits with "Missing config" on an empty home):
 *   1. onboard — baseline openclaw.json (gateway.mode=local), auth skipped
 *      (codex is separate), --skip-health (gateway isn't up yet)
 *   2. gateway.bind=lan — without it the gateway binds container-loopback only,
 *      so the host can't reach it through the published port ("Empty reply").
 *   3. gateway auth + remote token pinned equal so the loopback CLI authenticates.
 */
export function bootstrapCommands(): string[][] {
  return [
    ['onboard', '--non-interactive', '--accept-risk', '--mode', 'local', '--auth-choice', 'skip', '--skip-health'],
    ['config', 'set', 'gateway.bind', 'lan'],
    ['config', 'set', 'gateway.auth.token', GATEWAY_DEV_TOKEN],
    ['config', 'set', 'gateway.remote.token', GATEWAY_DEV_TOKEN],
  ]
}

/** Default tag pinned to match production (see dev/docker/Dockerfile). */
export const OPENCLAW_DEFAULT_IMAGE_TAG = '2026.6.11'

function openclawImage(deps: LifecycleDeps): string {
  return `ghcr.io/openclaw/openclaw:${deps.env.OPENCLAW_IMAGE_TAG || OPENCLAW_DEFAULT_IMAGE_TAG}`
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
  // Non-interactive openclaw CLI commands (config, models set). Sandbox execs into
  // the running container; native/isolated use the cli service. (Interactive codex
  // OAuth is handled separately — it drives the Codex CLI, not the openclaw CLI.)
  if (plan.bakin.placement === 'container') {
    return (args) => deps.runner.run(sandboxExecArgs(paths.composeFile, args, false), { env: secretsEnv })
  }
  return (args) => deps.runner.run(openclawExecArgs(paths.composeFile, args), { env: secretsEnv })
}

async function waitForGatewayHealthy(deps: LifecycleDeps, paths: InstancePaths): Promise<void> {
  for (let i = 0; i < HEALTH_RETRIES; i++) {
    const result = await deps.runner.run(healthCheckArgs())
    if (result.code === 0) return
    await deps.sleep(1000)
  }
  throw new Error(`OpenClaw gateway did not become healthy. Inspect: docker compose -f ${paths.composeFile} logs`)
}

async function wipeIfFresh(plan: InstancePlan, paths: InstancePaths, deps: LifecycleDeps): Promise<void> {
  if (plan.wipeBeforeUp.length === 0) return
  // Stop containers FIRST so they release the bind mount, then wipe contents
  // in place (never delete the mounted dir — see emptyDir).
  if (plan.docker) await deps.runner.run(composeDownArgs(paths.composeFile))
  for (const dir of plan.wipeBeforeUp) {
    deps.log(`wiping ${dir}`)
    await deps.emptyDir(dir)
  }
}

/**
 * Write the throwaway home's settings.json (isolated mode, both runtimes):
 * runtime.adapter + the guest-mode search URL — layer 1 of the guard that
 * keeps rig homes from ever provisioning the machine-global antfly unit.
 */
export async function applySettingsPatch(plan: InstancePlan, paths: InstancePaths, deps: LifecycleDeps): Promise<void> {
  if (!plan.settingsPatch || !paths.bakinHome) return
  await deps.mkdirp(paths.bakinHome)
  const file = join(paths.bakinHome, 'settings.json')
  const existing = deps.exists(file) ? deps.readTextFile(file) : null
  deps.writeTextFile(file, mergeThrowawaySettings(existing, plan.settingsPatch))
}

export async function up(
  plan: InstancePlan,
  paths: InstancePaths,
  secretTemplateText: string,
  deps: LifecycleDeps,
): Promise<void> {
  if (plan.runtime === 'pi') {
    await wipeIfFresh(plan, paths, deps)
    await applySettingsPatch(plan, paths, deps)
    return upPi(plan, paths, deps)
  }
  return upOpenClaw(plan, paths, secretTemplateText, deps)
}

/**
 * Pi up: no gateway, no secrets, no device pairing — Pi is in-process inside
 * Bakin. All this prepares is the throwaway pi home: agent dir, interactive
 * TUI /login when unauthenticated, and a routing.defaultModel so the first
 * dispatched turn resolves a model (warn-don't-fail, mirroring the openclaw
 * `models set` step).
 */
async function upPi(plan: InstancePlan, paths: InstancePaths, deps: LifecycleDeps): Promise<void> {
  await deps.mkdirp(piAgentDir(paths.piHome))

  if (plan.docker) {
    // sandbox-pi: bring the container up first; the TUI execs into it.
    const upResult = await deps.runner.run(
      composeUpArgs(paths.composeFile, plan.docker.services, plan.docker.composeProfile),
    )
    if (upResult.code !== 0) {
      throw new Error(`docker compose up failed: ${upResult.stderr.trim() || `exit ${upResult.code}`}`)
    }
  }

  const authFile = piAuthFile(paths.piHome)
  if (deps.exists(authFile)) {
    deps.log('pi: already authed')
  } else {
    deps.log('pi: opening the pi TUI — type /login, complete auth, then exit the TUI (Ctrl+C)…')
    const loginArgs = plan.docker ? sandboxPiLoginArgs(paths.composeFile) : piLoginArgs(paths.repoRoot)
    const loginEnv = plan.docker ? undefined : piLoginEnv(paths.piHome)
    const login = await deps.runner.run(loginArgs, { interactive: true, env: loginEnv })
    if (login.code !== 0 && !deps.exists(authFile)) {
      throw new Error(`pi TUI exited with ${login.code} before /login completed. Re-run \`instance up --runtime pi\`.`)
    }
    if (!deps.exists(authFile)) {
      // The TUI has no login subcommand, so its exit code proves nothing —
      // the auth file is the only evidence.
      throw new Error('pi auth.json is still missing — re-run `instance up --runtime pi` and complete /login before exiting the TUI.')
    }
  }

  // Default model: seeded main agent has none; an unresolvable model makes the
  // first turn fall to SDK defaults. Derive provider/model from auth.json +
  // the SDK's own per-provider table. Never fatal.
  try {
    const table = await deps.piDefaultModels()
    const model = defaultModelFromAuth(deps.readTextFile(authFile), table)
    if (!model) {
      deps.log('warning: could not derive a pi default model — pick one in the pi TUI or the Bakin UI')
    } else {
      const settingsFile = piSettingsFile(paths.piHome)
      const existing = deps.exists(settingsFile) ? deps.readTextFile(settingsFile) : null
      const patched = patchPiSettings(existing, model)
      if (patched) {
        deps.log(`pi: routing.defaultModel → ${model}`)
        deps.writeTextFile(settingsFile, patched)
      }
    }
  } catch (err) {
    deps.log(`warning: pi default-model setup failed (${err instanceof Error ? err.message : String(err)}) — pick one in the UI`)
  }

  deps.log('pi runtime ready.')
}

async function upOpenClaw(
  plan: InstancePlan,
  paths: InstancePaths,
  secretTemplateText: string,
  deps: LifecycleDeps,
): Promise<void> {
  const docker = plan.docker
  if (!docker) throw new Error('openclaw plan without docker services — resolvePlan bug')
  await preflight(deps)

  await wipeIfFresh(plan, paths, deps)
  await applySettingsPatch(plan, paths, deps)
  // Ensure the bind-mount target exists as a real, host-owned dir. CODEX_HOME (a
  // subdir inside it) must exist too — the Codex CLI refuses to start otherwise.
  await deps.mkdirp(paths.openclawHome)
  await deps.mkdirp(join(paths.openclawHome, 'codex'))

  // Pre-approve Bakin's gateway device (so operator.write / dispatch works) before
  // the gateway starts. No-op if an identity already exists.
  deps.ensureDevice()

  // Resolve secrets host-side; only resolved values flow onward (D4).
  const refs = parseSecretsTemplate(secretTemplateText)
  const secrets = await resolveSecrets(refs, deps.runner)
  const secretValues = Object.values(secrets)

  // The gateway exits on an empty home ("Missing config"), so bootstrap a
  // baseline config via one-off containers before bringing it up.
  if (!deps.exists(join(paths.openclawHome, 'openclaw.json'))) {
    deps.log('initializing OpenClaw config…')
    for (const command of bootstrapCommands()) {
      const result = await deps.runner.run(oneOffRunArgs(openclawImage(deps), paths.openclawHome, command))
      if (result.code !== 0) {
        throw new Error(`OpenClaw config init failed (${command.join(' ')}): ${result.stderr.trim() || `exit ${result.code}`}`)
      }
    }
  }

  // Reused rig state may hold HOST agent paths (stored pre-translation by a
  // previous run's `agents add`) — in-container dispatch then fails with
  // EACCES mkdir '/Users'. Rewrite them to the container home BEFORE the
  // gateway starts so it reads normalized config on boot (the stored-config
  // counterpart of the openclaw-shim's CLI arg translation, #467).
  const openclawConfigPath = join(paths.openclawHome, 'openclaw.json')
  if (deps.exists(openclawConfigPath)) {
    try {
      const parsed = JSON.parse(deps.readTextFile(openclawConfigPath)) as Record<string, unknown>
      const normalized = normalizeAgentPaths(parsed, paths.openclawHome)
      if (normalized.changed) {
        deps.log('normalizing stored agent paths to the container home…')
        deps.writeTextFile(openclawConfigPath, JSON.stringify(normalized.config, null, 2))
      }
    } catch (err) {
      deps.log(`agent-path normalization skipped (unreadable openclaw.json): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  deps.log('starting OpenClaw container…')
  // No secrets in the compose env: the compose file consumes none (only the
  // OPENCLAW_IMAGE_TAG build arg, which loadEnvFile already put on process.env).
  // Passing resolved tokens here would widen their exposure for no reason.
  const upResult = await deps.runner.run(
    composeUpArgs(paths.composeFile, docker.services, docker.composeProfile),
  )
  if (upResult.code !== 0) {
    throw new Error(`docker compose up failed: ${upResult.stderr.trim() || `exit ${upResult.code}`}`)
  }

  await waitForGatewayHealthy(deps, paths)

  // Configure exclusively via the OpenClaw CLI (D10). Discord is configured when
  // its token is present in the resolved secrets (template-driven, like brave).
  const exec = makeOpenClawExec(plan, paths, deps, secrets)
  const discordEnabled = Boolean(secrets.DISCORD_BOT_TOKEN)
  const configCommands = buildConfigCommands({
    braveApiKey: secrets.BRAVE_API_KEY,
    discord: discordEnabled
      ? { token: secrets.DISCORD_BOT_TOKEN, guildId: secrets.DISCORD_GUILD_ID, userId: secrets.DISCORD_USER_ID }
      : undefined,
  })
  for (const command of configCommands) {
    deps.log(redactSecrets(`config: openclaw ${command.join(' ')}`, secretValues))
    const result = await exec(command)
    if (result.code !== 0) {
      throw new Error(
        `openclaw ${command[0]} ${command[1]} failed: ${redactSecrets(result.stderr.trim(), secretValues) || `exit ${result.code}`}`,
      )
    }
  }

  // Codex auth: the codex provider reads ChatGPT creds from CODEX_HOME/auth.json,
  // written by the Codex CLI's own browser OAuth (OpenClaw has no managed auth
  // method for it). Skip when already authed (D3 — reset wipes it to force re-auth).
  if (deps.exists(codexAuthFile(paths.openclawHome))) {
    deps.log('codex: already authed')
  } else {
    deps.log('codex: ChatGPT device-code login — open the printed URL and enter the code…')
    const loginArgs = plan.bakin.placement === 'container'
      ? codexLoginExecArgs(paths.composeFile, docker.services[0])
      : codexLoginRunArgs(openclawImage(deps), paths.openclawHome)
    const login = await deps.runner.run(loginArgs, { interactive: true })
    if (login.code !== 0) {
      throw new Error(`Codex OAuth login failed (exit ${login.code}). Re-run \`instance up\` to retry the browser flow.`)
    }
  }

  // onboard skipped model selection, so point the default at the Codex catalog.
  // Warn-don't-fail: the user can pick a model in the UI if this can't resolve.
  const modelSet = await exec(['models', 'set', CODEX_DEFAULT_MODEL])
  if (modelSet.code !== 0) {
    deps.log(`warning: could not set default model ${CODEX_DEFAULT_MODEL} (${redactSecrets(modelSet.stderr.trim(), secretValues) || `exit ${modelSet.code}`}); set one in the UI`)
  }

  // The gateway started before config ran, so restart it to load the now-enabled
  // codex provider (+ its auth) and, when configured, the Discord bot.
  deps.log(`restarting gateway to load the provider${discordEnabled ? ' + Discord bot' : ''}…`)
  await deps.runner.run(composeRestartArgs(paths.composeFile, docker.services, docker.composeProfile))
  await waitForGatewayHealthy(deps, paths)

  // Bakin's MCP tool access is provisioned by Bakin itself, not the rig: at
  // boot the adapter's provisionToolAccess writes per-agent bakin-<agent>
  // entries into the runtime config's mcp.servers (same path as production).
  // The rig only supplies the container-reachable base URL via
  // BAKIN_MCP_BASE_URL in the host env (see modes.ts) — the openclaw home is
  // bind-mounted, so the entries land where the gateway reads them.
  deps.log('Bakin MCP tool access: provisioned by Bakin at boot (native MCP entries)')

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
    await deps.emptyDir(dir)
  }
}

export async function down(paths: InstancePaths, deps: LifecycleDeps): Promise<void> {
  await deps.runner.run(composeDownArgs(paths.composeFile))
}
