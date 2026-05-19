/**
 * Binary-facing CLI dispatcher (#147 TG2).
 *
 * The compiled `bakin` binary embeds server.ts as its entry point.
 * server.ts parses argv via `dispatchCli` and either starts the server
 * (`start`, `serve`, or the default) or runs a one-shot subcommand and exits.
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
import { readFileSync, writeFileSync } from 'node:fs'
import { APP_VERSION } from '../../packages/core/src/constants'
import { getCliUsageGroups, renderCliUsage } from './cli/registry'
import { parsePluginInstallArgs, PLUGIN_INSTALL_USAGE } from './cli/plugin-install-args'
import { isOnboarded } from './onboarding/state'
import {
  createPluginExportManifest,
  installPluginExportManifest,
  parsePluginExportManifest,
  serializePluginExportManifest,
  type PluginImportInstallRequest,
} from './plugins/import-export'
import { extractApiErrorMessage, formatApiError } from './cli/api-error'

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
    throw new Error(formatApiError(res.status, body))
  }
  return (await res.json()) as T
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseJsonText(text: string): unknown {
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function apiErrorPayload(status: number, body: string): Record<string, unknown> {
  const parsed = jsonObject(parseJsonText(body))
  const message = extractApiErrorMessage(body) || `HTTP ${status}`
  return {
    ...(parsed ?? {}),
    ok: false,
    status,
    error: typeof parsed?.error === 'string' && parsed.error.trim() ? parsed.error : message,
  }
}

async function apiPostJson(path: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; data: Record<string, unknown> }> {
  const res = await fetch(`${BAKIN_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) return { ok: false, data: apiErrorPayload(res.status, text) }
  return { ok: true, data: parseJsonText(text) }
}

async function cmdVersion(): Promise<number> {
  if (process.stdout.isTTY) {
    const [{ VersionReport }, { renderToString }, { createElement }] = await Promise.all([
      import('./cli/ui/readonly'),
      import('ink'),
      import('react'),
    ])
    console.log(renderToString(createElement(VersionReport, { data: { version: APP_VERSION } })))
  } else {
    console.log(APP_VERSION)
  }
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

function shouldSkipOnboardingCheck(args: string[]): boolean {
  return process.env.BAKIN_SKIP_ONBOARDING_CHECK === '1'
    || args.includes('--skip-onboarding-check')
}

async function printStartOnboardingGate(): Promise<void> {
  if (process.stdout.isTTY) {
    const [{ OnboardingRequiredReport }, { renderToString }, { createElement }] = await Promise.all([
      import('./cli/ui/onboarding'),
      import('ink'),
      import('react'),
    ])
    console.log(renderToString(createElement(OnboardingRequiredReport)))
    return
  }

  console.error('Bakin has not been onboarded on this machine.')
  console.error('Run: bakin onboard')
  console.error('To inspect readiness without changing anything, run: bakin onboard --check')
}

async function checkOnboardedBeforeStart(args: string[]): Promise<number | null> {
  if (shouldSkipOnboardingCheck(args)) return null
  if (isOnboarded()) return null
  await printStartOnboardingGate()
  return 1
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

async function runPluginsInstall(source: string, opts: { yes: boolean; dev?: boolean; force?: boolean; ref?: string; type?: 'github' | 'local' }): Promise<InstallApiResponse> {
  const isGithub = !opts.dev && (source.startsWith('github:') || (source.includes('/') && !source.startsWith('.') && !source.startsWith('/')))
  const type: 'github' | 'local' = opts.type ?? (isGithub ? 'github' : 'local')
  const ref = opts.ref

  // First call — preflight. With --yes the caller skips the consent
  // round-trip entirely, but we still go through preflight first so the
  // server can return a consentToken if it turns out the manifest needed
  // one (--yes implies "accept whatever permissions show up").
  let response = await api<InstallApiResponse>('/api/plugins/install', {
    method: 'POST',
    body: JSON.stringify({ source, type, ref, accepted: false, dev: opts.dev === true, force: opts.force === true }),
  })

  if (response.error) return response

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
      return { ok: false, error: 'install cancelled' }
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
    if (response.error) return response
  }

  if (response.awaitingConsent) {
    return { ok: false, error: 'manifest kept changing between preflight and commit; aborting' }
  }

  return response
}

async function cmdPluginsInstall(source: string, opts: { yes: boolean; dev?: boolean; force?: boolean; ref?: string }): Promise<number> {
  try {
    const response = await runPluginsInstall(source, opts)
    if (response.error) {
      console.error(`Install failed: ${response.error}`)
      return 1
    }
    console.log(response.message ?? `Installed "${response.id}".`)
    return 0
  } catch (err) {
    console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsExport(file?: string): Promise<number> {
  try {
    const manifest = createPluginExportManifest()
    const content = serializePluginExportManifest(manifest)
    if (file) {
      writeFileSync(file, content, 'utf-8')
      console.log(`Exported ${manifest.plugins.length} plugin(s) to ${file}`)
    } else {
      process.stdout.write(content)
    }
    return 0
  } catch (err) {
    console.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function installImportedPlugin(request: PluginImportInstallRequest, opts: { yes: boolean; force: boolean }): Promise<void> {
  const refNote = request.ref ? ` @ ${request.ref.slice(0, 12)}` : ''
  const modeNote = request.dev ? ' (dev)' : ''
  console.log(`Installing ${request.id}${modeNote} from ${request.source}${refNote}`)
  const response = await runPluginsInstall(request.source, {
    yes: opts.yes,
    dev: request.dev,
    force: opts.force,
    ref: request.ref,
    type: request.type,
  })
  if (response.error) throw new Error(response.error)
  console.log(response.message ?? `Installed "${response.id ?? request.id}".`)
}

async function cmdPluginsImport(file: string, opts: { yes: boolean; force: boolean }): Promise<number> {
  try {
    const manifest = parsePluginExportManifest(readFileSync(file, 'utf-8'))
    if (manifest.plugins.length === 0) {
      console.log('No plugins to import.')
      return 0
    }
    const result = await installPluginExportManifest(
      manifest,
      request => installImportedPlugin(request, opts),
    )
    if (result.ok) {
      console.log(`Imported ${result.installed.length} plugin(s).`)
      return 0
    }
    console.error(`Import failed after installing ${result.installed.length} plugin(s).`)
    for (const failure of result.failed) {
      console.error(`  ${failure.id}: ${failure.error}`)
    }
    return 1
  } catch (err) {
    console.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsUpgrade(pluginId: string, opts: { yes: boolean; json?: boolean }): Promise<number> {
  try {
    if (opts.json) {
      const response = await apiPostJson('/api/plugins/upgrade', { pluginId, yes: opts.yes })
      printJson(response.data)
      if (!response.ok) return 1
      const result = jsonObject(response.data) ?? {}
      if (result.core === true) return 2
      if (result.error || result.awaitingConsent === true) return 1
      return 0
    }

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
      pluginAssets?: {
        installed?: Array<{ pluginId: string; name: string }>
        unchanged?: Array<{ pluginId: string; name: string }>
        skipped?: Array<{ pluginId: string; name: string; reason: string }>
      }
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
      return cmdPluginsUpgrade(pluginId, { yes: true, json: opts.json })
    }
    const fromV = res.before?.version ?? '?'
    const toV = res.after?.version ?? '?'
    const fromSha = (res.before?.commitSha ?? '').slice(0, 8)
    const toSha = (res.after?.commitSha ?? '').slice(0, 8)
    const shaPart = fromSha && toSha ? ` (sha ${fromSha}...${toSha})` : ''
    console.log(`Upgraded ${pluginId} v${fromV} → v${toV}${shaPart} and activated it.`)
    const installedAssets = res.pluginAssets?.installed?.length ?? 0
    const skippedAssets = res.pluginAssets?.skipped?.length ?? 0
    if (installedAssets > 0 || skippedAssets > 0) {
      const skippedPart = skippedAssets > 0 ? `, ${skippedAssets} user-edited skipped` : ''
      console.log(`  Runtime skills: ${installedAssets} applied${skippedPart}`)
    }
    return 0
  } catch (err) {
    const message = `Upgrade failed: ${err instanceof Error ? err.message : String(err)}`
    if (opts.json) printJson({ ok: false, error: message })
    else console.error(message)
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

interface PluginRestoreSnapshot {
  pluginId: string
  timestamp: string
  createdAt: string
  filename: string
  path: string
  sizeBytes: number
}

interface PluginRestoreResponse {
  ok?: boolean
  error?: string
  code?: string
  core?: boolean
  id?: string
  restored?: boolean
  snapshot?: string
  snapshotInfo?: PluginRestoreSnapshot
  snapshots?: PluginRestoreSnapshot[]
  skills?: { restored: number; names: string[] }
  activated?: boolean
  message?: string
}

const PLUGIN_RESTORE_USAGE = 'Usage: bakin plugins restore <id> [--snapshot <snapshot>] [--force] [--list]'

function renderPluginSnapshots(pluginId: string, snapshots: PluginRestoreSnapshot[] = []): string[] {
  if (snapshots.length === 0) return [`No uninstall snapshots found for plugin "${pluginId}".`]
  return [
    `Uninstall snapshots for ${pluginId}:`,
    ...snapshots.map((s) => {
      const kb = Math.max(1, Math.ceil(s.sizeBytes / 1024))
      return `  ${s.timestamp}  ${s.createdAt}  ${kb}KB  ${s.filename}`
    }),
  ]
}

function parsePluginRestoreArgs(args: string[]): {
  pluginId?: string
  snapshot?: string
  force: boolean
  list: boolean
  error?: string
} {
  const pluginId = args[0]
  if (!pluginId) return { force: false, list: false, error: PLUGIN_RESTORE_USAGE }
  let snapshot: string | undefined
  let force = false
  let list = false
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--list') {
      list = true
      continue
    }
    if (arg === '--snapshot') {
      const value = args[i + 1]
      if (!value || value.startsWith('--')) {
        return { pluginId, force, list, error: '--snapshot requires a timestamp or filename' }
      }
      snapshot = value
      i++
      continue
    }
    return { pluginId, force, list, error: `Unknown plugins restore argument: ${arg}` }
  }
  return { pluginId, snapshot, force, list }
}

async function cmdPluginsRestore(
  pluginId: string,
  opts: { snapshot?: string; force: boolean; list: boolean },
): Promise<number> {
  try {
    const res = await fetch(`${BAKIN_URL}/api/plugins/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pluginId,
        snapshot: opts.snapshot,
        force: opts.force,
        listOnly: opts.list,
      }),
    })
    const body = await res.json().catch(() => ({})) as PluginRestoreResponse

    if (opts.list) {
      if (body.error) {
        console.error(`Restore failed: ${body.error}`)
        return body.core ? 2 : 1
      }
      for (const line of renderPluginSnapshots(pluginId, body.snapshots)) console.log(line)
      return 0
    }

    if (body.core) {
      console.error(`Refusing to restore core plugin "${pluginId}".`)
      return 2
    }
    if (!res.ok || body.error) {
      console.error(`Restore failed: ${body.error ?? `HTTP ${res.status}`}`)
      if (body.snapshots && body.snapshots.length > 0) {
        for (const line of renderPluginSnapshots(pluginId, body.snapshots)) console.error(line)
      }
      return 1
    }

    console.log(body.message ?? `Restored plugin: ${body.id ?? pluginId}`)
    if (body.snapshotInfo) {
      console.log(`  Snapshot: ${body.snapshotInfo.filename}`)
    } else if (body.snapshot) {
      console.log(`  Snapshot: ${body.snapshot}`)
    }
    if (body.skills) {
      console.log(`  Runtime skills restored: ${body.skills.restored}`)
    }
    if (body.activated === false) {
      console.log('  Activation deferred until next server start.')
    }
    return 0
  } catch (err) {
    console.error(`Restore failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

async function cmdPluginsScaffold(name: string, opts: { json?: boolean } = {}): Promise<number> {
  // Implementation lands in TH4 (src/core/plugin-scaffold.ts). Use a
  // variable specifier so TypeScript doesn't complain before that file
  // exists — the runtime import returns Cannot-find-module until then.
  try {
    const mod = await import(/* @vite-ignore */ './plugin-scaffold' as string) as {
      scaffoldPlugin: (name: string) => number
      createPluginScaffold: (name: string) => { ok: boolean }
    }
    if (opts.json) {
      const result = mod.createPluginScaffold(name)
      printJson(result)
      return result.ok ? 0 : 1
    }
    return mod.scaffoldPlugin(name)
  } catch (err) {
    const message = `plugins scaffold is not available: ${err instanceof Error ? err.message : String(err)}`
    if (opts.json) printJson({ ok: false, error: message })
    else console.error(message)
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
  if (process.stdout.isTTY) {
    const [{ HelpReport }, { renderToString }, { createElement }] = await Promise.all([
      import('./cli/ui/readonly'),
      import('ink'),
      import('react'),
    ])
    console.log(renderToString(createElement(HelpReport, {
      groups: getCliUsageGroups(),
      env: { bakinUrl: BAKIN_URL },
    })))
  } else {
    console.log(renderCliUsage({ bakinUrl: BAKIN_URL }))
  }
  return 0
}

/**
 * `bakin dev` — run the watch-mode dev loop against the bakin source tree.
 * Only makes sense from a source clone; the compiled binary has no
 * packages/host/src/ to watch, so it errors out with a clear pointer.
 * Exported so the legacy cli/bakin.ts entry point can delegate here.
 */
export async function cmdDev(devArgs: string[] = process.argv.slice(3)): Promise<number> {
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
  const proc = spawn('bun', ['run', devScript, ...devArgs], { stdio: 'inherit', cwd: repoRoot })
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

class DelegatedCliExit extends Error {
  constructor(readonly code: number) {
    super(`delegated cli exit ${code}`)
    this.name = 'BakinDelegatedCliExit'
  }
}

async function delegateToSourceCli(argv: string[]): Promise<CliResult> {
  const previousArgv = process.argv
  const previousExit = process.exit
  process.argv = argv
  process.exit = ((code?: string | number | null | undefined) => {
    const numericCode = typeof code === 'number' ? code : Number(code ?? 0)
    throw new DelegatedCliExit(Number.isFinite(numericCode) ? numericCode : 1)
  }) as never

  try {
    const { main: runSourceCli } = await import(/* @vite-ignore */ '../../cli/bakin' as string) as { main: () => Promise<void> }
    await runSourceCli()
    return { startServer: false, exitCode: 0 }
  } catch (err) {
    if (err instanceof DelegatedCliExit) {
      return { startServer: false, exitCode: err.code }
    }
    throw err
  } finally {
    process.argv = previousArgv
    process.exit = previousExit
  }
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

  if (cmd === 'start') {
    const gateExitCode = await checkOnboardedBeforeStart(args)
    if (gateExitCode !== null) return { startServer: false, exitCode: gateExitCode }
    return { startServer: true, exitCode: 0 }
  }

  if (cmd === 'serve') {
    return { startServer: true, exitCode: 0 }
  }

  try {
    switch (cmd) {
      case 'version':
      case '--version':
      case '-v':
        return { startServer: false, exitCode: await cmdVersion() }

      case 'update':
        return { startServer: false, exitCode: await cmdUpdate() }

      case 'dev':
        return { startServer: false, exitCode: await cmdDev(args.slice(1)) }

      // Runtime/status commands delegate to the source CLI so the compiled
      // binary uses the same TUI/JSON implementation as the npm-linked entry.
      case 'status':
      case 'stop':
      case 'plugins':
        return await delegateToSourceCli(argv)

      default: {
        // Delegate to the legacy CLI (doctor, tasks, workflows, agents,
        // schedule, search, settings, trash, paths, reindex, restart,
        // onboard, setup, logs, agent-rules, etc.).
        return await delegateToSourceCli(argv)
      }
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return { startServer: false, exitCode: 1 }
  }
}
