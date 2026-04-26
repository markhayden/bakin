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

async function cmdPluginsList(): Promise<number> {
  try {
    const res = await api<{ plugins: Array<{ id: string; name: string; version: string }> }>(
      '/api/plugins/manifest',
    )
    if (res.plugins.length === 0) {
      console.log('(no plugins registered)')
      return 0
    }
    for (const p of res.plugins) {
      console.log(`  ${p.id.padEnd(12)} ${p.name} (${p.version})`)
    }
    return 0
  } catch (err) {
    console.error('Error: Cannot reach a running Bakin server.')
    console.error(`  Detail: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsInstall(source: string): Promise<number> {
  const isGithub = source.startsWith('github:') || (source.includes('/') && !source.startsWith('.') && !source.startsWith('/'))
  const body = { source, type: isGithub ? 'github' : 'local' }
  try {
    const res = await api<Record<string, unknown>>('/api/plugins/install', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    console.log(JSON.stringify(res, null, 2))
    return 0
  } catch (err) {
    console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsRemove(pluginId: string): Promise<number> {
  try {
    const res = await api<{ ok?: boolean; error?: string; core?: boolean }>('/api/plugins/remove', {
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
    console.log(`Removed plugin "${pluginId}"`)
    return 0
  } catch (err) {
    console.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`)
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
          console.error('Usage: bakin plugins <list|install|remove|scaffold>')
          return { startServer: false, exitCode: 1 }
        }
        if (sub === 'list') return { startServer: false, exitCode: await cmdPluginsList() }
        if (sub === 'install') {
          if (!args[2]) {
            console.error('Usage: bakin plugins install <path|github:user/repo>')
            return { startServer: false, exitCode: 1 }
          }
          return { startServer: false, exitCode: await cmdPluginsInstall(args[2]) }
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
        console.error(`Unknown plugins subcommand: ${sub}`)
        return { startServer: false, exitCode: 1 }
      }

      default: {
        // Delegate to the legacy CLI (doctor, tasks, workflows, agents,
        // schedule, messaging, search, settings, trash, paths, reindex,
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
