/**
 * Binary-facing CLI dispatcher (#147 TG2).
 *
 * The compiled `bakin` binary embeds server.ts as its entry point.
 * server.ts parses argv via `dispatchCli` and either starts the server
 * (`start`, the default) or runs a one-shot subcommand and exits.
 *
 * Subcommands that talk to a running server do so over HTTP via
 * `${BAKIN_URL || http://localhost:3737}` — same shape as the legacy
 * `cli/bakin.ts`. Subcommands that don't (e.g. `version`, `scaffold`)
 * execute in-process.
 *
 * Exit codes:
 *   0 — success
 *   1 — generic error (server unreachable, invalid input, etc.)
 *   2 — refusal (e.g. core-plugin removal)
 */
import { APP_VERSION } from '../../packages/core/src/constants'
import { renderCliUsage } from './cli/registry'
import { parsePluginInstallArgs, PLUGIN_INSTALL_USAGE } from './cli/plugin-install-args'

const BAKIN_URL = process.env.BAKIN_URL || 'http://localhost:3737'

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BAKIN_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return (await res.json()) as T
}

async function cmdVersion(): Promise<number> {
  console.log(APP_VERSION)
  return 0
}

async function cmdStatus(): Promise<number> {
  try {
    const info = await api<Record<string, unknown>>('/api/dispatch')
    console.log('=== Bakin Status ===')
    console.log(`Version: ${APP_VERSION}`)
    console.log(`Dispatch interval: ${info.intervalMin}min`)
    console.log(`Last run: ${info.lastRun || 'never'}`)
    console.log(`Next run: ${info.nextRun} (${info.secondsUntilNext}s)`)
    return 0
  } catch (err) {
    console.error('Error: Cannot reach a running Bakin server.')
    console.error(`  Tried: ${BAKIN_URL}/api/dispatch`)
    console.error(`  Detail: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdStop(): Promise<number> {
  // Find the Bakin server PID and send SIGTERM. On macOS + Linux we ask the
  // server for its own pid first (returned via /api/version headers) — if
  // the server is unreachable, fall back to pgrep-style discovery.
  try {
    const res = await fetch(`${BAKIN_URL}/api/version`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) throw new Error(`status ${res.status}`)
  } catch {
    console.log('No running Bakin server at ' + BAKIN_URL)
    return 0
  }
  // No /api/shutdown endpoint; rely on SIGTERM via pgrep. The binary
  // names itself `bakin` so pgrep -x bakin finds it.
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync('pgrep', ['-f', 'bakin'], { encoding: 'utf-8' })
  const pids = result.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(pid => pid && pid !== process.pid)
  if (pids.length === 0) {
    console.log('No running Bakin process found')
    return 0
  }
  let stopped = 0
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM')
      stopped++
    } catch {
      // Might not be ours — skip.
    }
  }
  console.log(`Sent SIGTERM to ${stopped} process(es)`)
  return 0
}

interface ListPluginRow {
  id: string
  name: string
  version: string
  source: 'core' | 'github' | 'local'
  upgradeAvailable: boolean
  staleHintDays: number | null
  installed: { version: string; linked?: boolean; linkedSource?: string } | null
}

function renderPluginsList(rows: ListPluginRow[]): string[] {
  const COL = { id: 14, name: 18, version: 11, source: 14 }
  const out: string[] = []
  out.push(
    `  ${'ID'.padEnd(COL.id)} ${'NAME'.padEnd(COL.name)} ${'VERSION'.padEnd(COL.version)} ${'SOURCE'.padEnd(COL.source)} STATUS`,
  )
  for (const r of rows) {
    const isLinked = r.installed?.linked === true
    const sourceCell = r.source === 'core'
      ? '[core]'
      : (isLinked ? '[linked]' : r.source)
    let status = ''
    if (r.source === 'core') {
      // Core plugins don't have lifecycle status — column stays blank.
      status = ''
    } else if (isLinked) {
      const target = r.installed?.linkedSource ?? '?'
      status = `→ ${target}`
    } else if (r.upgradeAvailable) {
      status = 'upgrade available'
    } else if (r.staleHintDays !== null) {
      status = `(last checked ${r.staleHintDays} days ago — run with --check)`
    } else if (r.installed) {
      status = 'up to date'
    } else {
      status = '(no lockfile entry)'
    }
    out.push(
      `  ${r.id.padEnd(COL.id)} ${r.name.padEnd(COL.name)} ${r.version.padEnd(COL.version)} ${sourceCell.padEnd(COL.source)} ${status}`,
    )
  }
  return out
}

async function cmdPluginsList(opts: { check: boolean }): Promise<number> {
  try {
    const path = opts.check ? '/api/plugins/manifest?check=1' : '/api/plugins/manifest'
    const res = await api<{ plugins: ListPluginRow[] }>(path)
    if (res.plugins.length === 0) {
      console.log('(no plugins registered)')
      return 0
    }
    for (const line of renderPluginsList(res.plugins)) {
      console.log(line)
    }
    return 0
  } catch (err) {
    console.error('Error: Cannot reach a running Bakin server.')
    console.error(`  Detail: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

interface InstallApiResponse {
  ok?: boolean
  error?: string
  awaitingConsent?: boolean
  manifestChanged?: boolean
  id?: string
  version?: string
  permissions?: import('@bakin/core/plugins/permissions').Permission[]
  consentToken?: string
  message?: string
}

async function cmdPluginsInstall(source: string, opts: { yes: boolean; dev?: boolean; force?: boolean; ref?: string }): Promise<number> {
  const isGithub = !opts.dev && (source.startsWith('github:') || (source.includes('/') && !source.startsWith('.') && !source.startsWith('/')))
  const type: 'github' | 'local' = isGithub ? 'github' : 'local'
  const ref = opts.ref
  try {
    // First call — preflight. With --yes the caller skips the consent
    // round-trip entirely, but we still go through preflight first so the
    // server can return a consentToken if it turns out the manifest needed
    // one (--yes implies "accept whatever permissions show up").
    let response = await api<InstallApiResponse>('/api/plugins/install', {
      method: 'POST',
      body: JSON.stringify({ source, type, ref, accepted: false, dev: opts.dev === true, force: opts.force === true }),
    })

    if (response.error) {
      console.error(`Install failed: ${response.error}`)
      return 1
    }

    // Loop the prompt — if the server bounces back with manifestChanged,
    // re-prompt with the new diff. Cap to a few iterations as a sanity
    // bound against a pathological remote that flaps the manifest.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!response.awaitingConsent) break
      const { promptInstallConsent } = await import(/* @vite-ignore */ './cli/consent-prompt' as string) as typeof import('./cli/consent-prompt')
      if (response.manifestChanged) {
        console.error(`\nManifest changed between preflight and commit — re-confirming permissions.`)
      }
      const accepted = await promptInstallConsent({
        pluginId: response.id ?? '?',
        version: response.version ?? '0.0.0',
        permissions: response.permissions ?? [],
        yes: opts.yes,
      })
      if (!accepted) {
        console.error(`\nInstall cancelled.`)
        return 1
      }
      response = await api<InstallApiResponse>('/api/plugins/install', {
        method: 'POST',
        body: JSON.stringify({
          source,
          type,
          ref,
          accepted: true,
          consentToken: response.consentToken,
          dev: opts.dev === true,
          force: opts.force === true,
        }),
      })
      if (response.error) {
        console.error(`Install failed: ${response.error}`)
        return 1
      }
    }
    if (response.awaitingConsent) {
      console.error(`Install failed: manifest kept changing between preflight and commit; aborting.`)
      return 1
    }

    console.log(response.message ?? `Installed "${response.id}".`)
    return 0
  } catch (err) {
    console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsUpgrade(pluginId: string, opts: { yes: boolean }): Promise<number> {
  try {
    const res = await api<{
      ok?: boolean
      error?: string
      core?: boolean
      id?: string
      noop?: boolean
      awaitingConsent?: boolean
      newPermissions?: string[]
      before?: { version: string; commitSha: string }
      after?: { version: string; commitSha: string }
    }>('/api/plugins/upgrade', {
      method: 'POST',
      body: JSON.stringify({ pluginId, yes: opts.yes }),
    })
    if (res.core) {
      console.error(`Refusing to upgrade core plugin "${pluginId}".`)
      return 2
    }
    if (res.error) {
      console.error(`Upgrade failed: ${res.error}`)
      return 1
    }
    if (res.noop) {
      const v = res.before?.version ?? '?'
      console.log(`${pluginId} v${v}: already up to date`)
      return 0
    }
    if (res.awaitingConsent) {
      const { promptUpgradeConsent } = await import(/* @vite-ignore */ './cli/consent-prompt' as string) as typeof import('./cli/consent-prompt')
      const accepted = await promptUpgradeConsent({
        pluginId,
        fromVersion: res.before?.version ?? '?',
        toVersion: res.after?.version ?? '?',
        newPermissions: (res.newPermissions ?? []) as import('@bakin/core/plugins/permissions').Permission[],
        yes: opts.yes,
      })
      if (!accepted) {
        console.error(`\nUpgrade cancelled.`)
        return 1
      }
      // Re-run with yes:true so the server completes the upgrade.
      return cmdPluginsUpgrade(pluginId, { yes: true })
    }
    const fromV = res.before?.version ?? '?'
    const toV = res.after?.version ?? '?'
    const fromSha = (res.before?.commitSha ?? '').slice(0, 8)
    const toSha = (res.after?.commitSha ?? '').slice(0, 8)
    const shaPart = fromSha && toSha ? ` (sha ${fromSha}...${toSha})` : ''
    console.log(`Upgraded ${pluginId} v${fromV} → v${toV}${shaPart} and activated it.`)
    return 0
  } catch (err) {
    console.error(`Upgrade failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsRemove(pluginId: string): Promise<number> {
  try {
    const res = await api<{
      ok?: boolean
      error?: string
      core?: boolean
      id?: string
      skills?: { removed: number; kept: number }
      skillsMissing?: string[]
      sweep?: { hooks: number; execTools: number; contentTypes: number }
      snapshot?: string | null
      message?: string
    }>('/api/plugins/remove', {
      method: 'POST',
      body: JSON.stringify({ pluginId }),
    })
    if (res.core) {
      console.error(`Refusing to remove core plugin "${pluginId}".`)
      return 2
    }
    if (res.error) {
      console.error(`Remove failed: ${res.error}`)
      return 1
    }
    console.log(`Removed plugin: ${res.id ?? pluginId}`)
    if (res.skills) {
      console.log(`  Cleaned ${res.skills.removed} runtime skill(s) (created-by-${res.id ?? pluginId})`)
      if (res.skills.kept > 0) {
        console.log(`  Kept ${res.skills.kept} user-edited runtime skill(s)`)
      }
    }
    if (res.skillsMissing && res.skillsMissing.length > 0) {
      // Lockfile claimed ownership of skills not present (or marker
      // mismatch). Surface so users notice silent drift.
      console.error(`  WARNING: lockfile claimed ${res.skillsMissing.length} skill(s) not present on disk: ${res.skillsMissing.join(', ')}`)
    }
    if (res.snapshot) {
      console.log(`  Snapshot saved: ${res.snapshot}`)
    } else {
      // Snapshot is the safety net — surface its absence loudly so the
      // user can recover (or knows to back up before retrying).
      console.error(`  WARNING: pre-removal snapshot failed — plugin files cannot be restored from ~/.bakin/.uninstalled/`)
    }
    // Exit non-zero when the snapshot failed so scripted callers can react.
    return res.snapshot ? 0 : 1
  } catch (err) {
    console.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsLink(localPath: string, opts: { force: boolean }): Promise<number> {
  try {
    const res = await api<{
      ok?: boolean
      error?: string
      id?: string
      pluginDir?: string
      linkedSource?: string
      version?: string
      message?: string
    }>('/api/plugins/link', {
      method: 'POST',
      body: JSON.stringify({ localPath, force: opts.force }),
    })
    if (res.error) {
      console.error(`Link failed: ${res.error}`)
      return 1
    }
    console.log(res.message ?? `Linked "${res.id}".`)
    if (res.linkedSource) {
      console.log(`  ~/.bakin/plugins/${res.id} → ${res.linkedSource}`)
    }
    return 0
  } catch (err) {
    console.error(`Link failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsUnlink(pluginId: string): Promise<number> {
  try {
    const res = await api<{ ok?: boolean; error?: string; id?: string; message?: string }>(
      '/api/plugins/unlink',
      {
        method: 'POST',
        body: JSON.stringify({ pluginId }),
      },
    )
    if (res.error) {
      console.error(`Unlink failed: ${res.error}`)
      return 1
    }
    console.log(res.message ?? `Unlinked "${res.id ?? pluginId}".`)
    return 0
  } catch (err) {
    console.error(`Unlink failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsScaffold(name: string): Promise<number> {
  // Implementation lands in TH4 (src/core/plugin-scaffold.ts). Use a
  // variable specifier so TypeScript doesn't complain before that file
  // exists — the runtime import returns Cannot-find-module until then.
  try {
    const mod = await import(/* @vite-ignore */ './plugin-scaffold' as string) as { scaffoldPlugin: (name: string) => number }
    return mod.scaffoldPlugin(name)
  } catch (err) {
    console.error(`plugins scaffold is not available: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdUpdate(): Promise<number> {
  // Implementation lands in TG4 (src/core/self-update.ts). Same pattern
  // as cmdPluginsScaffold — variable specifier to keep TS happy.
  try {
    const mod = await import(/* @vite-ignore */ './self-update' as string) as { selfUpdate: () => Promise<number> }
    return mod.selfUpdate()
  } catch (err) {
    console.error(`update is not available: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdHelp(): Promise<number> {
  console.log(renderCliUsage({ bakinUrl: BAKIN_URL }))
  return 0
}

/**
 * `bakin dev` — run the watch-mode dev loop against the bakin source tree.
 * Only makes sense from a source clone; the compiled binary has no
 * packages/host/src/ to watch, so it errors out with a clear pointer.
 * Exported so the legacy cli/bakin.ts entry point can delegate here.
 */
export async function cmdDev(): Promise<number> {
  // Source mode: this file resolves from the on-disk repo layout so we can
  // locate the sibling scripts/dev.ts. In the compiled binary the module
  // lives under the `/$bunfs/` virtual filesystem, which doesn't contain
  // scripts/ — detection is "does a scripts/dev.ts sibling exist next to
  // my resolved location on a real fs?".
  const { fileURLToPath } = await import('node:url')
  const { existsSync } = await import('node:fs')
  const { join, dirname, resolve } = await import('node:path')

  let here: string
  try { here = fileURLToPath(import.meta.url) } catch { here = '' }
  // Walk up from src/core/cli.ts to the repo root and probe.
  const repoRoot = here ? resolve(dirname(here), '..', '..') : process.cwd()
  const devScript = join(repoRoot, 'scripts', 'dev.ts')
  if (!existsSync(devScript)) {
    console.error('`bakin dev` only runs from a bakin source tree.')
    console.error('Clone https://github.com/markhayden/bakin and run `bakin dev` from the repo root.')
    return 1
  }

  const { spawn } = await import('node:child_process')
  const proc = spawn('bun', ['run', devScript], { stdio: 'inherit', cwd: repoRoot })
  return await new Promise<number>((resolvePromise) => {
    proc.once('close', (code: number | null) => resolvePromise(code ?? 0))
    proc.once('error', (err) => {
      console.error('Failed to spawn dev:', err instanceof Error ? err.message : String(err))
      resolvePromise(1)
    })
  })
}


export interface CliResult {
  /** Whether to continue booting the server after dispatch returns. */
  startServer: boolean
  /** Exit code for one-shot commands. Ignored when startServer is true. */
  exitCode: number
}

/**
 * Parse argv and dispatch. Returns `{ startServer: true }` only when the
 * user asked for `start` (explicit or default). Otherwise the command
 * executed inline and the caller should `process.exit(exitCode)`.
 */
export async function dispatchCli(argv: string[]): Promise<CliResult> {
  const args = argv.slice(2)
  // No-arg invocation is `start` — the compiled binary's primary job.
  const cmd = args[0] ?? 'start'
  const sub = args[1]

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    return { startServer: false, exitCode: await cmdHelp() }
  }

  if (cmd === 'start') return { startServer: true, exitCode: 0 }

  try {
    switch (cmd) {
      case 'version':
      case '--version':
      case '-v':
        return { startServer: false, exitCode: await cmdVersion() }

      case 'status':
        return { startServer: false, exitCode: await cmdStatus() }

      case 'stop':
        return { startServer: false, exitCode: await cmdStop() }

      case 'update':
        return { startServer: false, exitCode: await cmdUpdate() }

      case 'dev':
        return { startServer: false, exitCode: await cmdDev() }

      // `restart` falls through to the legacy delegation below so there's
      // a single implementation (cmdReboot in cli/bakin.ts).

      case 'plugins': {
        if (!sub) {
          console.error('Usage: bakin plugins <list|install|upgrade|remove|scaffold|link|unlink>')
          return { startServer: false, exitCode: 1 }
        }
        if (sub === 'list') {
          const check = args.slice(2).includes('--check')
          return { startServer: false, exitCode: await cmdPluginsList({ check }) }
        }
        if (sub === 'install') {
          const installArgs = args.slice(2)
          const parsed = parsePluginInstallArgs(installArgs)
          if (parsed.error || !parsed.source) {
            console.error(parsed.error ? `${parsed.error}\n${PLUGIN_INSTALL_USAGE}` : PLUGIN_INSTALL_USAGE)
            return { startServer: false, exitCode: 1 }
          }
          return {
            startServer: false,
            exitCode: await cmdPluginsInstall(parsed.source, {
              yes: parsed.yes,
              dev: parsed.dev,
              force: parsed.force,
              ref: parsed.ref,
            }),
          }
        }
        if (sub === 'upgrade') {
          if (!args[2]) {
            console.error('Usage: bakin plugins upgrade <id> [--yes]')
            return { startServer: false, exitCode: 1 }
          }
          const yes = args.slice(3).includes('--yes')
          return { startServer: false, exitCode: await cmdPluginsUpgrade(args[2], { yes }) }
        }
        if (sub === 'remove') {
          if (!args[2]) {
            console.error('Usage: bakin plugins remove <id>')
            return { startServer: false, exitCode: 1 }
          }
          return { startServer: false, exitCode: await cmdPluginsRemove(args[2]) }
        }
        if (sub === 'scaffold') {
          if (!args[2]) {
            console.error('Usage: bakin plugins scaffold <name>')
            return { startServer: false, exitCode: 1 }
          }
          return { startServer: false, exitCode: await cmdPluginsScaffold(args[2]) }
        }
        if (sub === 'link') {
          if (!args[2]) {
            console.error('Usage: bakin plugins link <localPath> [--force]')
            return { startServer: false, exitCode: 1 }
          }
          const force = args.slice(3).includes('--force')
          return { startServer: false, exitCode: await cmdPluginsLink(args[2], { force }) }
        }
        if (sub === 'unlink') {
          if (!args[2]) {
            console.error('Usage: bakin plugins unlink <id>')
            return { startServer: false, exitCode: 1 }
          }
          return { startServer: false, exitCode: await cmdPluginsUnlink(args[2]) }
        }
        console.error(`Unknown plugins subcommand: ${sub}`)
        return { startServer: false, exitCode: 1 }
      }

      default: {
        // Delegate to the legacy CLI (doctor, tasks, workflows, agents,
        // schedule, search, settings, trash, paths, reindex,
        // onboard, setup, init, logs, agent-rules, etc.). The legacy
        // handler calls process.exit internally on success/failure, so
        // we don't return here.
        const { main: runLegacyCli } = await import(/* @vite-ignore */ '../../cli/bakin' as string) as { main: () => Promise<void> }
        await runLegacyCli()
        return { startServer: false, exitCode: 0 }
      }
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return { startServer: false, exitCode: 1 }
  }
}
