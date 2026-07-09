/**
 * `bakin plugins {list,install,publish,export,import,remove,upgrade,restore,link,unlink,scaffold}`
 * — plugin lifecycle. Relocated verbatim from cli/bakin.ts (B5.3
 * command-module split); this module owns the whiskit publish/artifacts-index,
 * plugin import-export, and node:fs static imports so they stay out of the
 * CLI entry's import graph.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { APP_VERSION } from '../../../packages/core/src/constants'
import { assemblePluginArtifact, indexFromEntries } from '../../core/whiskit/publish'
import {
  INDEX_FILENAME,
  NEUTRAL_PLATFORM,
  mergeArtifactsIndex,
  readArtifactsIndex,
  writeArtifactsIndex,
} from '../../core/whiskit/artifacts-index'
import { BASE_URL, apiGet, apiPost, apiPostJson, jsonObject } from '../http'
import { print } from '../output'
import { exitCommandIssue, exitUsage, exitUnknownSubcommand } from '../help'
import { parsePluginInstallArgs, PLUGIN_INSTALL_USAGE } from '../../core/cli/plugin-install-args'
import {
  createPluginExportManifest,
  installPluginExportManifest,
  parsePluginExportManifest,
  serializePluginExportManifest,
  type PluginImportInstallRequest,
} from '../../core/plugins/import-export'
import type { Permission } from '@bakin/core/plugins/permissions'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type {
  PluginActionData,
  PluginRestoreResultData,
  PluginRestoreSnapshotData,
} from '../../core/cli/ui/readonly'

async function printPluginsListTui(plugins: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.PluginsListReport, { plugins })
}

async function printPluginActionTui(actions: PluginActionData | PluginActionData[]): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.PluginActionReport, {
    actions: Array.isArray(actions) ? actions : [actions],
  })
}

async function printPluginRestoreSnapshotsTui(pluginId: string, snapshots: PluginRestoreSnapshotData[]): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.PluginRestoreSnapshotsReport, { pluginId, snapshots })
}

async function printPluginRestoreResultTui(pluginId: string, result: PluginRestoreResultData): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.PluginRestoreResultReport, { pluginId, result })
}

/**
 * `bakin plugins publish <pluginDir> --out <dir> [--build]` — assemble a
 * published artifact from a plugin directory (Whiskit Phase 4). Purely local:
 * reads the manifest, stamps provenance, tars + checksums the artifact, and
 * writes (or carries forward into) whiskit-artifacts.json. With `--build`,
 * the Whiskit build backend compiles the plugin first via the system bun
 * (Phase 2) — producers no longer need a separate `bun run build` step.
 */
async function cmdPluginsPublish(
  pluginDir: string,
  opts: { out: string; baseUrl?: string; platform?: string; json?: boolean; build?: boolean },
): Promise<void> {
  const { existsSync } = await import('node:fs')
  const { resolve, join } = await import('node:path')

  const abs = resolve(pluginDir)
  const manifestPath = join(abs, 'bakin-plugin.json')
  if (!existsSync(manifestPath)) {
    await exitCommandIssue(`No bakin-plugin.json found in ${abs}`, {
      command: 'bakin plugins publish',
      usage: 'bakin plugins publish <pluginDir> --out <dir> [--build] [--base-url <url>] [--platform <p>] [--json]',
    })
    return
  }
  let manifest: { id?: string; version?: string; bakin?: string }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    await exitCommandIssue(`Invalid bakin-plugin.json: ${err instanceof Error ? err.message : String(err)}`, {
      command: 'bakin plugins publish',
    })
    return
  }
  if (!manifest.id || !manifest.version) {
    await exitCommandIssue('bakin-plugin.json must declare "id" and "version"', {
      command: 'bakin plugins publish',
    })
    return
  }

  if (opts.build) {
    const { buildPluginWithSystemBun } = await import('../../core/whiskit/build')
    const { WhiskitBuildError } = await import('../../core/whiskit/types')
    try {
      const result = await buildPluginWithSystemBun({
        pluginDir: abs,
        pluginId: manifest.id,
        production: true,
        installDeps: true,
      })
      if (!opts.json) {
        console.log(`Built ${manifest.id} (server${result.builtClient ? ' + client' : ''}, ${result.durationMs}ms)`)
      }
    } catch (err) {
      const detail = err instanceof WhiskitBuildError
        ? `[${err.stage}] ${err.message}`
        : err instanceof Error ? err.message : String(err)
      await exitCommandIssue(`Build failed: ${detail}`, {
        command: 'bakin plugins publish',
      })
      return
    }
  }

  if (!existsSync(join(abs, 'dist', 'index.js'))) {
    await exitCommandIssue(`No dist/index.js in ${abs} — build the plugin first or pass --build.`, {
      command: 'bakin plugins publish',
    })
    return
  }

  const platform = opts.platform || NEUTRAL_PLATFORM
  const bakinRange = manifest.bakin || `>=${APP_VERSION}`
  const filename = `${manifest.id}-${manifest.version}-${platform}.tar.gz`
  const artifactUrl = opts.baseUrl ? `${opts.baseUrl.replace(/\/+$/, '')}/${filename}` : filename
  const outDir = resolve(opts.out)

  const result = await assemblePluginArtifact({
    builtDir: abs,
    pluginId: manifest.id,
    pluginVersion: manifest.version,
    bakinVersion: APP_VERSION,
    bakinRange,
    platform,
    whiskitVersion: '1',
    buildBackend: 'system-bun',
    artifactUrl,
    outDir,
    builtAt: new Date().toISOString(),
  })

  // Carry forward an existing index in the same out dir (so messaging+projects
  // publish into one complete release catalog).
  const indexPath = join(outDir, INDEX_FILENAME)
  const fresh = indexFromEntries([result.indexEntry])
  const index = existsSync(indexPath)
    ? mergeArtifactsIndex(readArtifactsIndex(indexPath), fresh)
    : fresh
  writeArtifactsIndex(indexPath, index)

  if (opts.json) {
    print({ pluginId: manifest.id, version: manifest.version, platform, artifact: result.artifactPath, sha256: result.sha256, index: indexPath })
    return
  }
  console.log(`Published ${manifest.id}@${manifest.version} (${platform})`)
  console.log(`  artifact: ${result.artifactPath}`)
  console.log(`  sha256:   ${result.sha256}`)
  console.log(`  checksum: ${result.artifactPath}.sha256`)
  console.log(`  index:    ${indexPath}`)
}

async function cmdPluginsList(opts: { json?: boolean; check?: boolean } = {}): Promise<void> {
  const path = opts.check ? '/api/plugins/manifest?check=1' : '/api/plugins/manifest'
  const manifest = await apiGet(path) as { plugins: Array<Record<string, unknown>> }
  if (opts.json) {
    print(manifest)
    return
  }
  if (process.stdout.isTTY) {
    await printPluginsListTui(manifest.plugins)
    return
  }
  console.log('Installed plugins:')
  for (const plugin of manifest.plugins) {
    const status = plugin.upgradeAvailable === true ? 'update available' : String(plugin.status ?? 'unknown')
    // Failed plugins carry the actionable reason (e.g. the T15 host-range
    // refusal) — without it a bare "failed" hides what to fix.
    const reason = plugin.status === 'failed' && plugin.errorMessage ? ` — ${String(plugin.errorMessage)}` : ''
    console.log(`  ${String(plugin.id ?? '').padEnd(20)} ${String(plugin.source ?? '-').padEnd(8)} ${String(plugin.version ?? '-').padEnd(8)} ${status}${reason}`)
  }
}

async function cmdPluginsInstall(source: string, opts: { yes?: boolean; dev?: boolean; force?: boolean; ref?: string; json?: boolean } = {}): Promise<void> {
  const type = !opts.dev && (source.startsWith('github:') || source.includes('/') && !source.startsWith('.') && !source.startsWith('/'))
    ? 'github'
    : 'local'
  const result = await apiPost('/api/plugins/install', {
    source,
    type,
    ref: opts.ref,
    accepted: false,
    dev: opts.dev === true,
    force: opts.force === true,
  }) as {
    awaitingConsent?: boolean
    consentToken?: string
  }
  if (opts.yes && result.awaitingConsent && result.consentToken) {
    const accepted = await apiPost('/api/plugins/install', {
      source,
      type,
      ref: opts.ref,
      accepted: true,
      consentToken: result.consentToken,
      dev: opts.dev === true,
      force: opts.force === true,
    })
    if (!opts.json && process.stdout.isTTY) {
      await printPluginActionTui({
        action: 'installed',
        source,
        result: accepted,
      })
      return
    }
    print(accepted)
  } else {
    if (!opts.json && process.stdout.isTTY) {
      await printPluginActionTui({
        action: 'installed',
        source,
        result,
      })
      return
    }
    print(result)
  }
}

async function cmdPluginsExport(file?: string, opts: { json?: boolean } = {}): Promise<void> {
  const manifest = createPluginExportManifest()
  const content = serializePluginExportManifest(manifest)
  if (file) {
    writeFileSync(file, content, 'utf-8')
    if (opts.json) {
      print({ ok: true, file, count: manifest.plugins.length, manifest })
      return
    }
    if (process.stdout.isTTY) {
      await printPluginActionTui({
        action: 'exported',
        file,
        result: { ok: true, count: manifest.plugins.length },
      })
      return
    }
    console.log(`Exported ${manifest.plugins.length} plugin(s) to ${file}`)
  } else {
    process.stdout.write(content)
  }
}

async function installImportedPluginLegacy(
  request: PluginImportInstallRequest,
  opts: { yes: boolean; force: boolean; quiet?: boolean },
): Promise<void> {
  if (!opts.quiet) console.log(`Installing ${request.id} from ${request.source}${request.ref ? ` @ ${request.ref.slice(0, 12)}` : ''}`)
  let result = await apiPost('/api/plugins/install', {
    source: request.source,
    type: request.type,
    ref: request.ref,
    accepted: false,
    dev: request.dev,
    force: opts.force,
  }) as {
    error?: string
    awaitingConsent?: boolean
    consentToken?: string
    message?: string
    id?: string
  }
  if (result.error) throw new Error(result.error)

  for (let attempt = 0; attempt < 3 && result.awaitingConsent; attempt++) {
    if (!opts.yes) {
      throw new Error(`plugin "${request.id}" requires permission consent; rerun with --yes or install it directly`)
    }
    result = await apiPost('/api/plugins/install', {
      source: request.source,
      type: request.type,
      ref: request.ref,
      accepted: true,
      consentToken: result.consentToken,
      dev: request.dev,
      force: opts.force,
    }) as typeof result
    if (result.error) throw new Error(result.error)
  }

  if (result.awaitingConsent) {
    throw new Error(`plugin "${request.id}" manifest kept changing between preflight and commit`)
  }
  if (!opts.quiet) console.log(result.message ?? `Installed "${result.id ?? request.id}".`)
}

async function cmdPluginsImport(file: string, opts: { yes: boolean; force: boolean; json?: boolean }): Promise<void> {
  const manifest = parsePluginExportManifest(readFileSync(file, 'utf-8'))
  const quiet = process.stdout.isTTY || opts.json === true
  const result = await installPluginExportManifest(
    manifest,
    request => installImportedPluginLegacy(request, { ...opts, quiet }),
  )
  if (opts.json) {
    print(result)
    if (!result.ok) process.exit(1)
    return
  }
  if (process.stdout.isTTY) {
    await printPluginActionTui({
      action: 'imported',
      file,
      result,
    })
    if (!result.ok) process.exit(1)
    return
  }
  if (result.ok) {
    console.log(`Imported ${result.installed.length} plugin(s).`)
    return
  }
  console.error(`Import failed after installing ${result.installed.length} plugin(s).`)
  for (const failure of result.failed) {
    console.error(`  ${failure.id}: ${failure.error}`)
  }
  process.exit(1)
}

async function cmdPluginsRemove(pluginId: string, opts: { json?: boolean } = {}): Promise<void> {
  const result = await apiPost('/api/plugins/remove', { pluginId })
  if (!opts.json && process.stdout.isTTY) {
    await printPluginActionTui({
      action: 'removed',
      pluginId,
      result,
    })
    return
  }
  print(result)
}

async function cmdPluginsUpgrade(pluginId: string, opts: { yes?: boolean; json?: boolean } = {}): Promise<void> {
  if (opts.json) {
    let response: Awaited<ReturnType<typeof apiPostJson>>
    try {
      response = await apiPostJson('/api/plugins/upgrade', { pluginId, yes: opts.yes === true })
    } catch (err) {
      print({ ok: false, error: err instanceof Error ? err.message : String(err) })
      process.exit(1)
    }
    print(response.data)
    if (!response.ok) process.exit(1)
    const result = jsonObject(response.data) ?? {}
    if (result.awaitingConsent === true) process.exit(1)
    if (result.core === true) process.exit(2)
    if (result.error) process.exit(1)
    return
  }

  let result: Record<string, unknown>
  try {
    result = await apiPost('/api/plugins/upgrade', { pluginId, yes: opts.yes === true }) as Record<string, unknown>
  } catch (err) {
    if (process.stdout.isTTY) {
      await printPluginActionTui({
        action: 'upgraded',
        pluginId,
        result: { ok: false, error: err instanceof Error ? err.message : String(err) },
      })
      process.exit(1)
    }
    throw err
  }
  const failed = result.core === true || Boolean(result.error)
  if (!opts.json && result.awaitingConsent === true) {
    const { promptUpgradeConsent } = await import('../../core/cli/consent-prompt')
    const before = result.before && typeof result.before === 'object' ? result.before as Record<string, unknown> : {}
    const after = result.after && typeof result.after === 'object' ? result.after as Record<string, unknown> : {}
    const accepted = await promptUpgradeConsent({
      pluginId,
      fromVersion: String(before.version ?? '?'),
      toVersion: String(after.version ?? '?'),
      newPermissions: Array.isArray(result.newPermissions) ? result.newPermissions as Permission[] : [],
      yes: opts.yes === true,
    })
    if (!accepted) {
      await printPluginActionTui({
        action: 'upgraded',
        pluginId,
        result: { ok: false, error: 'Upgrade cancelled.' },
      })
      process.exit(1)
    }
    result = await apiPost('/api/plugins/upgrade', { pluginId, yes: true }) as Record<string, unknown>
  }

  if (process.stdout.isTTY) {
    await printPluginActionTui({
      action: 'upgraded',
      pluginId,
      result,
    })
    if (result.core === true) process.exit(2)
    if (result.error) process.exit(1)
    return
  }

  print(result)
  if (failed) process.exit(result.core === true ? 2 : 1)
}

async function cmdPluginsScaffold(name: string, opts: { json?: boolean } = {}): Promise<void> {
  const { createPluginScaffold } = await import('../../core/plugin-scaffold')
  const result = createPluginScaffold(name)

  if (!opts.json && process.stdout.isTTY) {
    await printPluginActionTui({
      action: 'scaffolded',
      pluginId: name,
      result,
    })
    if (!result.ok) process.exit(1)
    return
  }

  if (opts.json) {
    print(result)
  } else if (result.ok) {
    console.log(`Scaffolded plugin at ${result.root}`)
    console.log('')
    console.log('Next steps:')
    for (const next of result.next ?? []) console.log(`  ${next}`)
  } else {
    console.error(result.error)
  }
  if (!result.ok) process.exit(1)
}

async function cmdPluginsSyncManifest(dir: string, opts: { check?: boolean; json?: boolean } = {}): Promise<void> {
  const { syncPluginManifest } = await import('../../core/plugin-sync-manifest')
  const result = await syncPluginManifest(dir, { check: opts.check })

  if (opts.json) {
    print(result)
    if (!result.ok || (opts.check && result.changed)) process.exit(1)
    return
  }

  if (!result.ok) {
    console.error(result.error)
    process.exit(1)
  }

  const diff = result.diff!
  const lines: string[] = []
  for (const key of diff.apiRoutes.added) lines.push(`  + apiRoutes: ${key}`)
  for (const key of diff.apiRoutes.removed) lines.push(`  - apiRoutes: ${key}`)
  for (const name of diff.execTools.added) lines.push(`  + execTools: ${name}`)
  for (const name of diff.execTools.removed) lines.push(`  - execTools: ${name}`)

  if (!result.changed) {
    console.log(`Manifest in sync (${diff.apiRoutes.kept} routes, ${diff.execTools.kept} exec tools).`)
  } else if (opts.check) {
    console.log('Manifest drift detected:')
    for (const line of lines) console.log(line)
    console.log(`Run \`bakin plugins sync-manifest\` to update ${result.manifestPath}.`)
  } else {
    console.log(`Updated ${result.manifestPath}:`)
    for (const line of lines) console.log(line)
  }
  console.log(`Note: ${result.note}`)
  if (opts.check && result.changed) process.exit(1)
}

interface PluginRestoreSnapshot {
  timestamp: string
  createdAt: string
  filename: string
  sizeBytes: number
}

interface PluginRestoreResult {
  ok?: boolean
  error?: string
  core?: boolean
  message?: string
  snapshot?: string
  snapshotInfo?: PluginRestoreSnapshot
  snapshots?: PluginRestoreSnapshot[]
  skills?: { restored: number }
  restored?: boolean
  activated?: boolean
}

const PLUGIN_RESTORE_USAGE = 'Usage: bakin plugins restore <id> [--snapshot <snapshot>] [--force] [--list]'

function parsePluginRestoreFlags(flags: string[]): {
  snapshot?: string
  force: boolean
  list: boolean
  error?: string
} {
  let snapshot: string | undefined
  let force = false
  let list = false
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]
    if (flag === '--force') {
      force = true
      continue
    }
    if (flag === '--list') {
      list = true
      continue
    }
    if (flag === '--snapshot') {
      const value = flags[i + 1]
      if (!value || value.startsWith('--')) return { force, list, error: '--snapshot requires a timestamp or filename' }
      snapshot = value
      i++
      continue
    }
    return { force, list, error: `Unknown plugins restore argument: ${flag}` }
  }
  return { snapshot, force, list }
}

function printPluginRestoreSnapshots(pluginId: string, snapshots: PluginRestoreSnapshot[] = []): void {
  if (snapshots.length === 0) {
    console.log(`No uninstall snapshots found for plugin "${pluginId}".`)
    return
  }
  console.log(`Uninstall snapshots for ${pluginId}:`)
  for (const snapshot of snapshots) {
    const kb = Math.max(1, Math.ceil(snapshot.sizeBytes / 1024))
    console.log(`  ${snapshot.timestamp}  ${snapshot.createdAt}  ${kb}KB  ${snapshot.filename}`)
  }
}

async function cmdPluginsRestore(pluginId: string, opts: { snapshot?: string; force: boolean; list: boolean }): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/plugins/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pluginId,
      snapshot: opts.snapshot,
      force: opts.force,
      listOnly: opts.list,
    }),
  })
  const result = await res.json().catch(() => ({})) as PluginRestoreResult
  if (opts.list) {
    if (result.error) throw new Error(result.error)
    if (process.stdout.isTTY) {
      await printPluginRestoreSnapshotsTui(pluginId, result.snapshots ?? [])
      return
    }
    printPluginRestoreSnapshots(pluginId, result.snapshots)
    return
  }
  if (!res.ok || result.error) {
    if (result.snapshots && result.snapshots.length > 0) {
      if (process.stdout.isTTY) await printPluginRestoreSnapshotsTui(pluginId, result.snapshots)
      else printPluginRestoreSnapshots(pluginId, result.snapshots)
    }
    throw new Error(result.error ?? `HTTP ${res.status}`)
  }
  if (process.stdout.isTTY) {
    await printPluginRestoreResultTui(pluginId, result)
    return
  }
  console.log(result.message ?? `Restored plugin: ${pluginId}`)
  if (result.snapshotInfo) {
    console.log(`  Snapshot: ${result.snapshotInfo.filename}`)
  } else if (result.snapshot) {
    console.log(`  Snapshot: ${result.snapshot}`)
  }
  if (result.skills) console.log(`  Runtime skills restored: ${result.skills.restored}`)
  if (result.activated === false) console.log('  Activation deferred until next server start.')
}

async function cmdPluginsLink(localPath: string, opts: { force?: boolean; json?: boolean } = {}): Promise<void> {
  const result = await apiPost('/api/plugins/link', {
    localPath,
    force: opts.force === true,
  })
  if (!opts.json && process.stdout.isTTY) {
    await printPluginActionTui({
      action: 'linked',
      source: localPath,
      result,
    })
    return
  }
  print(result)
}

async function cmdPluginsUnlink(pluginId: string, opts: { json?: boolean } = {}): Promise<void> {
  const result = await apiPost('/api/plugins/unlink', { pluginId })
  if (!opts.json && process.stdout.isTTY) {
    await printPluginActionTui({
      action: 'unlinked',
      pluginId,
      result,
    })
    return
  }
  print(result)
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (sub === 'list') {
    await cmdPluginsList({ json: args.includes('--json'), check: args.includes('--check') })
  } else if (sub === 'install') {
    const installArgs = args.slice(2)
    const parsed = parsePluginInstallArgs(installArgs)
    const source = parsed.source
    if (parsed.error || !source) {
      await exitCommandIssue(parsed.error ?? 'Missing required arguments.', {
        command: 'bakin plugins install',
        usage: PLUGIN_INSTALL_USAGE,
        plainMessage: Boolean(parsed.error),
      })
      return
    }
    await cmdPluginsInstall(source, {
      yes: parsed.yes,
      dev: parsed.dev,
      force: parsed.force,
      ref: parsed.ref,
      json: parsed.json,
    })
  } else if (sub === 'publish') {
    const PUBLISH_USAGE = 'bakin plugins publish <pluginDir> --out <dir> [--build] [--base-url <url>] [--platform <p>] [--json]'
    const flags = args.slice(2)
    const dir = flags.find(arg => !arg.startsWith('--'))
    const flagValue = (name: string): string | undefined => {
      const i = flags.indexOf(name)
      return i >= 0 && i + 1 < flags.length ? flags[i + 1] : undefined
    }
    const out = flagValue('--out')
    if (!dir || !out) {
      await exitCommandIssue(!dir ? 'Missing <pluginDir>.' : 'Missing required --out <dir>.', {
        command: 'bakin plugins publish',
        usage: PUBLISH_USAGE,
      })
      return
    }
    await cmdPluginsPublish(dir, {
      out,
      baseUrl: flagValue('--base-url'),
      platform: flagValue('--platform'),
      json: flags.includes('--json'),
      build: flags.includes('--build'),
    })
  } else if (sub === 'export') {
    const flags = args.slice(2)
    const file = flags.find(arg => !arg.startsWith('--'))
    const extraArg = flags.filter(arg => !arg.startsWith('--')).slice(1)[0]
    if (extraArg) {
      await exitCommandIssue(`Unexpected plugins export argument: ${extraArg}`, {
        command: 'bakin plugins export',
        usage: 'bakin plugins export [file] [--json]',
      })
    }
    const unknown = flags.find(arg => arg.startsWith('--') && arg !== '--json')
    if (unknown) {
      await exitCommandIssue(`Unknown plugins export flag: ${unknown}`, {
        command: 'bakin plugins export',
        usage: 'bakin plugins export [file] [--json]',
      })
    }
    await cmdPluginsExport(file, { json: flags.includes('--json') })
  } else if (sub === 'import') {
    if (!args[2]) await exitUsage('bakin plugins import <file> [--yes] [--force] [--json]')
    const flags = args.slice(3)
    const extraArg = flags.find(arg => !arg.startsWith('--'))
    if (extraArg) {
      await exitCommandIssue(`Unexpected plugins import argument: ${extraArg}`, {
        command: 'bakin plugins import',
        usage: 'bakin plugins import <file> [--yes] [--force] [--json]',
      })
    }
    const unknown = flags.find(arg => arg.startsWith('--') && arg !== '--yes' && arg !== '--force' && arg !== '--json')
    if (unknown) {
      await exitCommandIssue(`Unknown plugins import flag: ${unknown}`, {
        command: 'bakin plugins import',
        usage: 'bakin plugins import <file> [--yes] [--force] [--json]',
      })
    }
    await cmdPluginsImport(args[2], { yes: flags.includes('--yes'), force: flags.includes('--force'), json: flags.includes('--json') })
  } else if (sub === 'remove') {
    if (!args[2]) await exitUsage('bakin plugins remove <id> [--json]')
    await cmdPluginsRemove(args[2], { json: args.slice(3).includes('--json') })
  } else if (sub === 'upgrade') {
    if (!args[2]) await exitUsage('bakin plugins upgrade <id> [--yes] [--json]')
    const flags = args.slice(3)
    await cmdPluginsUpgrade(args[2], { yes: flags.includes('--yes'), json: flags.includes('--json') })
  } else if (sub === 'restore') {
    if (!args[2]) await exitUsage(PLUGIN_RESTORE_USAGE)
    const parsed = parsePluginRestoreFlags(args.slice(3))
    if (parsed.error) {
      await exitCommandIssue(parsed.error, {
        command: 'bakin plugins restore',
        usage: PLUGIN_RESTORE_USAGE,
      })
    }
    await cmdPluginsRestore(args[2], {
      snapshot: parsed.snapshot,
      force: parsed.force,
      list: parsed.list,
    })
  } else if (sub === 'link') {
    if (!args[2]) await exitUsage('bakin plugins link <localPath> [--force] [--json]')
    await cmdPluginsLink(args[2], { force: args.slice(3).includes('--force'), json: args.slice(3).includes('--json') })
  } else if (sub === 'unlink') {
    if (!args[2]) await exitUsage('bakin plugins unlink <id> [--json]')
    await cmdPluginsUnlink(args[2], { json: args.slice(3).includes('--json') })
  } else if (sub === 'scaffold') {
    if (!args[2]) await exitUsage('bakin plugins scaffold <name> [--json]')
    await cmdPluginsScaffold(args[2], { json: args.slice(3).includes('--json') })
  } else if (sub === 'sync-manifest') {
    const flags = args.slice(2).filter(arg => arg.startsWith('--'))
    const positional = args.slice(2).filter(arg => !arg.startsWith('--'))
    const unknown = flags.find(arg => arg !== '--check' && arg !== '--json')
    if (unknown) {
      await exitCommandIssue(`Unknown plugins sync-manifest flag: ${unknown}`, {
        command: 'bakin plugins sync-manifest',
        usage: 'bakin plugins sync-manifest [dir] [--check] [--json]',
      })
    }
    await cmdPluginsSyncManifest(positional[0] ?? '.', {
      check: flags.includes('--check'),
      json: flags.includes('--json'),
    })
  } else {
    await exitUnknownSubcommand('plugins', sub, ['list', 'install', 'export', 'import', 'remove', 'upgrade', 'restore', 'link', 'unlink', 'scaffold', 'sync-manifest'])
  }
}
