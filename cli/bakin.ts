#!/usr/bin/env bun
/**
 * Bakin CLI — command-line interface for Bakin orchestration platform.
 * All commands are thin wrappers around the Bakin HTTP API.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { APP_VERSION } from '../packages/core/src/constants'
import { assemblePluginArtifact, indexFromEntries } from '../src/core/whiskit/publish'
import {
  INDEX_FILENAME,
  NEUTRAL_PLATFORM,
  mergeArtifactsIndex,
  readArtifactsIndex,
  writeArtifactsIndex,
} from '../src/core/whiskit/artifacts-index'
import {
  BASE_URL,
  api,
  apiGet,
  apiPost,
  apiPostJson,
  apiDelete,
  jsonObject,
  isServerConnectionError,
  getCliAgent,
} from '../src/cli/http'
import { printRuntimeActionTui } from '../src/cli/commands/runtime'
import {
  print,
  printTable,
  invocationCommand,
  statusIcon,
} from '../src/cli/output'
import {
  BINARY_ONLY_COMMANDS,
  USAGE,
  printPluginCliCommandResult,
  printHelpTui,
  printCommandFailureTui,
  printVersionTui,
  exitCommandIssue,
  exitUsage,
  exitUnknownSubcommand,
  exitCommandFailure,
  promptYesNo,
  confirmPrompt,
} from '../src/cli/help'
import { getSettings, updateSettings } from '../src/core/settings'
import { parsePluginInstallArgs, PLUGIN_INSTALL_USAGE } from '../src/core/cli/plugin-install-args'
import {
  createPluginExportManifest,
  installPluginExportManifest,
  parsePluginExportManifest,
  serializePluginExportManifest,
  type PluginImportInstallRequest,
} from '../src/core/plugins/import-export'
import type { Permission } from '@bakin/core/plugins/permissions'
import { renderInkReport } from '../src/core/cli/ui/render-report'
import type {
  PackageActionData,
  PluginActionData,
  PluginRestoreResultData,
  PluginRestoreSnapshotData,
  SettingsActionData,
} from '../src/core/cli/ui/readonly'
import type { CheckResult, InstallResult } from '../src/core/onboarding/types'

async function printSettingsTui(settings: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.SettingsReport, { settings })
}

async function printSettingsActionTui(action: SettingsActionData): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.SettingsActionReport, { action })
}

async function printPathsTui(paths: Record<string, unknown>, isBakinHome: unknown): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.PathsReport, { paths, isBakinHome })
}

async function printAgentsListTui(agents: Array<{ id: string; name: string; status: string; model: string }>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.AgentsListReport, { agents })
}

async function printAgentStatusTui(agentId: string, profile: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.AgentStatusReport, { agentId, profile })
}

async function printAgentTasksTui(agentId: string, tasks: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.AgentTasksReport, { agentId, tasks })
}

async function printPluginsListTui(plugins: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.PluginsListReport, { plugins })
}

async function printPluginActionTui(actions: PluginActionData | PluginActionData[]): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.PluginActionReport, {
    actions: Array.isArray(actions) ? actions : [actions],
  })
}

async function printPluginRestoreSnapshotsTui(pluginId: string, snapshots: PluginRestoreSnapshotData[]): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.PluginRestoreSnapshotsReport, { pluginId, snapshots })
}

async function printPluginRestoreResultTui(pluginId: string, result: PluginRestoreResultData): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.PluginRestoreResultReport, { pluginId, result })
}

async function printAgentPackagesListTui(agents: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.AgentPackagesListReport, { agents })
}

async function printAgentLessonsListTui(
  agentId: string,
  packageId: string,
  lessons: Array<Record<string, unknown>>,
): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.AgentLessonsListReport, { agentId, packageId, lessons })
}

async function printPackagesListTui(packages: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.PackagesListReport, { packages })
}

async function printPackageActionTui(actions: PackageActionData | PackageActionData[]): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/readonly'), (m) => m.PackageActionReport, {
    actions: Array.isArray(actions) ? actions : [actions],
  })
}

async function printOnboardingCheckTui(result: CheckResult): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/onboarding'), (m) => m.OnboardingCheckReport, { result })
}

async function printOnboardingCheckAllTui(results: CheckResult[]): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/onboarding'), (m) => m.OnboardingCheckAllReport, { results })
}

async function printOnboardingInstallTui(result: InstallResult): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/onboarding'), (m) => m.OnboardingInstallReport, { result })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdAgentsList(opts: { json?: boolean } = {}): Promise<void> {
  const result = await apiGet('/api/plugins/team/') as {
    agents: Array<{ id: string; name: string; status: string; model: string }>
  }
  if (opts.json) {
    print(result)
    return
  }
  if (process.stdout.isTTY) {
    await printAgentsListTui(result.agents)
    return
  }
  for (const agent of result.agents) {
    const statusIcon = agent.status === 'working' ? '●' : agent.status === 'online' ? '○' : '·'
    console.log(`  ${statusIcon} ${agent.id}: ${agent.name} [${agent.status}] (${agent.model})`)
  }
}

async function cmdAgentsSend(agentId: string, message: string): Promise<void> {
  const result = await apiPost(`/api/agents/${agentId}/message`, { message })
  if (process.stdout.isTTY) {
    await printRuntimeActionTui({
      action: 'message',
      target: agentId,
      detail: message,
      result,
    })
    return
  }
  print(result)
}

async function cmdAgentsStatus(agentId: string, opts: { json?: boolean } = {}): Promise<void> {
  const result = await apiGet(`/api/plugins/team/${agentId}`) as Record<string, unknown>
  if (!opts.json && process.stdout.isTTY) {
    await printAgentStatusTui(agentId, result)
    return
  }
  print(result)
}

async function cmdAgentsTasks(agentId: string): Promise<void> {
  const result = await apiGet(`/api/agents/${agentId}/tasks`) as { tasks: Array<Record<string, unknown>> }
  if (process.stdout.isTTY) {
    await printAgentTasksTui(agentId, result.tasks)
    return
  }
  printTable(result.tasks, ['id', 'title', 'column'])
}

async function cmdSettingsGet(key?: string, opts: { json?: boolean } = {}): Promise<void> {
  const settings = await apiGet('/api/settings') as Record<string, unknown>
  if (key) {
    const parts = key.split('.')
    let val: unknown = settings
    let found = true
    for (const part of parts) {
      if (val && typeof val === 'object' && Object.prototype.hasOwnProperty.call(val, part)) {
        val = (val as Record<string, unknown>)[part]
      } else {
        val = undefined
        found = false
        break
      }
    }
    if (opts.json) {
      print(found ? val : null)
      return
    }
    if (!opts.json && process.stdout.isTTY) {
      await printSettingsTui({ [key]: val })
      return
    }
    print(val)
  } else {
    if (opts.json) {
      print(settings)
      return
    }
    if (process.stdout.isTTY) {
      await printSettingsTui(settings)
      return
    }
    print(settings)
  }
}

async function cmdSettingsSet(key: string, value: string, opts: { json?: boolean } = {}): Promise<void> {
  const parts = key.split('.')
  const obj: Record<string, unknown> = {}
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {}
    current = current[parts[i]] as Record<string, unknown>
  }

  // Try to parse as JSON, fall back to string
  let parsedValue: unknown
  try {
    parsedValue = JSON.parse(value)
  } catch {
    parsedValue = value
  }
  current[parts[parts.length - 1]] = parsedValue

  const result = await apiPost('/api/settings', obj)
  if (!opts.json && process.stdout.isTTY) {
    await printSettingsActionTui({
      action: 'updated',
      key,
      value: parsedValue,
      result,
    })
    return
  }

  print(result)
}

interface DiagnosticsStartupOptions {
  json?: boolean
  slowMs?: number
}

function parseSlowMsFlag(args: string[]): { slowMs?: number; error?: string } {
  let slowMs: number | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--slow-ms') {
      const raw = args[i + 1]
      if (!raw) return { error: '--slow-ms requires a value' }
      i += 1
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0) return { error: '--slow-ms must be a non-negative number' }
      slowMs = Math.round(parsed)
    } else if (arg.startsWith('--slow-ms=')) {
      const raw = arg.slice('--slow-ms='.length)
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0) return { error: '--slow-ms must be a non-negative number' }
      slowMs = Math.round(parsed)
    }
  }
  return { slowMs }
}

function parseDiagnosticsStartupOptions(args: string[]): DiagnosticsStartupOptions & { error?: string } {
  const parsed = parseSlowMsFlag(args)
  if (parsed.error) return { error: parsed.error }
  return {
    json: args.includes('--json'),
    slowMs: parsed.slowMs,
  }
}

function withSilentLocalSettings<T>(fn: () => T): T {
  const previousConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  process.env.BAKIN_CONSOLE_FORMAT = 'silent'
  try {
    return fn()
  } finally {
    if (previousConsoleFormat === undefined) delete process.env.BAKIN_CONSOLE_FORMAT
    else process.env.BAKIN_CONSOLE_FORMAT = previousConsoleFormat
  }
}

function readStartupDiagnosticsSettings() {
  return withSilentLocalSettings(() => getSettings().diagnostics.startup)
}

function writeStartupDiagnosticsSettings(enabled: boolean, slowMs?: number) {
  return withSilentLocalSettings(() => updateSettings({
    diagnostics: {
      startup: {
        enabled,
        ...(slowMs !== undefined ? { slowMs } : {}),
      },
    },
  }).diagnostics.startup)
}

function printStartupDiagnosticsStatus(
  action: 'status' | 'enabled' | 'disabled',
  startup: { enabled: boolean; slowMs: number },
  opts: { json?: boolean } = {},
): void {
  const payload = {
    startup,
    restartRequired: true,
    envOverrides: {
      enabled: 'BAKIN_STARTUP_DIAGNOSTICS=1|0',
      slowMs: 'BAKIN_STARTUP_SLOW_MS=<milliseconds>',
      verbose: 'BAKIN_CONSOLE_FORMAT=verbose or BAKIN_LOG_LEVEL=debug',
    },
  }
  if (opts.json) {
    print(payload)
    return
  }

  const label = startup.enabled ? 'enabled' : 'disabled'
  if (action === 'status') {
    console.log(`Startup diagnostics: ${label}`)
  } else {
    console.log(`Startup diagnostics ${action}.`)
  }
  console.log(`Slow-span threshold: ${startup.slowMs}ms`)
  console.log('Applies on next server start. Use `bakin restart` after changing it.')
}

async function cmdDiagnosticsStartup(action: string | undefined, args: string[]): Promise<void> {
  const opts = parseDiagnosticsStartupOptions(args)
  if (opts.error) await exitCommandIssue(opts.error, {
    command: 'bakin diagnostics startup',
    usage: 'bakin diagnostics startup <status|on|off> [--slow-ms <ms>] [--json]',
  })

  if (!action || action === 'status') {
    if (opts.slowMs !== undefined) await exitCommandIssue('--slow-ms can only be used with `on` or `off`.', {
      command: 'bakin diagnostics startup status',
    })
    printStartupDiagnosticsStatus('status', readStartupDiagnosticsSettings(), opts)
    return
  }

  if (action === 'on' || action === 'enable' || action === 'enabled') {
    const startup = writeStartupDiagnosticsSettings(true, opts.slowMs)
    printStartupDiagnosticsStatus('enabled', startup, opts)
    return
  }

  if (action === 'off' || action === 'disable' || action === 'disabled') {
    const startup = writeStartupDiagnosticsSettings(false, opts.slowMs)
    printStartupDiagnosticsStatus('disabled', startup, opts)
    return
  }

  await exitUnknownSubcommand('diagnostics startup', action, ['status', 'on', 'off'])
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
    const { buildPluginWithSystemBun } = await import('../src/core/whiskit/build')
    const { WhiskitBuildError } = await import('../src/core/whiskit/types')
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
    console.log(`  ${String(plugin.id ?? '').padEnd(20)} ${String(plugin.source ?? '-').padEnd(8)} ${String(plugin.version ?? '-').padEnd(8)} ${status}`)
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
    const { promptUpgradeConsent } = await import('../src/core/cli/consent-prompt')
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
  const { createPluginScaffold } = await import('../src/core/plugin-scaffold')
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

// ---------------------------------------------------------------------------
// Agent-package commands — `bakin agents ...`
// ---------------------------------------------------------------------------

interface AgentsCmdFlags {
  adopt?: boolean
  installAs?: string
  replace?: boolean
  keepBlocks?: boolean
  deleteAgent?: boolean
  check?: boolean
  reclaim?: string[]
  reclaimAll?: boolean
  yes?: boolean
  force?: boolean
  json?: boolean
}

async function cmdAgentPackagesInstall(source: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = { source }
  if (flags.adopt) body.adopt = source // installer reads any truthy adopt as the agentId
  if (flags.installAs) body.installAs = flags.installAs
  if (flags.replace) body.replace = true
  const result = await apiPost('/api/agent-packages/install', body)
  if (!flags.json && process.stdout.isTTY) {
    await printPackageActionTui({
      action: 'installed',
      scope: 'agent package',
      target: flags.installAs ?? source,
      result,
    })
    return
  }
  print(result)
}

async function cmdAgentPackagesList(flags: AgentsCmdFlags): Promise<void> {
  const result = await apiGet('/api/agent-packages') as {
    ok: boolean
    agents: Array<{
      agentId: string
      state: string
      version?: string
      packageId?: string
      entry?: { version?: string }
    }>
  }
  if (flags.json) {
    print(result)
    return
  }
  if (process.stdout.isTTY) {
    await printAgentPackagesListTui(result.agents)
    return
  }
  console.log('Agents (package state):')
  for (const a of result.agents) {
    const version = a.version ?? a.entry?.version ?? '-'
    const pkg = a.packageId ? `  [${a.packageId}]` : ''
    console.log(`  ${a.agentId.padEnd(20)} ${a.state.padEnd(10)} ${version.padEnd(10)}${pkg}`)
  }
}

async function cmdAgentPackagesRemove(agentId: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.keepBlocks) body.keepBlocks = true
  if (flags.deleteAgent) body.deleteAgent = true
  if (flags.force) body.force = true
  const result = await apiDelete(`/api/agent-packages/${encodeURIComponent(agentId)}`, body)
  if (!flags.json && process.stdout.isTTY) {
    await printPackageActionTui({
      action: 'removed',
      scope: 'agent package',
      target: agentId,
      result,
    })
    return
  }
  print(result)
}

async function cmdAgentPackagesOrphan(agentId: string, flags: AgentsCmdFlags): Promise<void> {
  await cmdAgentPackagesRemove(agentId, { ...flags, deleteAgent: false })
}

async function cmdAgentPackagesDelete(agentId: string, flags: AgentsCmdFlags): Promise<void> {
  await cmdAgentPackagesRemove(agentId, { ...flags, deleteAgent: true })
}

async function cmdAgentPackagesSync(agentId: string | undefined, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.check) body.check = true
  if (flags.reclaimAll) body.reclaim = 'all'
  else if (flags.reclaim?.length) body.reclaim = flags.reclaim

  const syncOne = async (id: string): Promise<unknown> => {
    // apiPostJson (not apiPost) — the 409 migrationRequired response is a
    // structured payload we branch on, not a transport error to throw.
    const first = await apiPostJson(`/api/agent-packages/${encodeURIComponent(id)}/sync`, body)
    let result = first.data as Record<string, unknown>
    if (result.migrationRequired) {
      const confirmed = flags.yes || await confirmPrompt(
        `Package for "${id}" predates block-based projection. Run the one-time migration?\n` +
        '  This FULLY OVERWRITES package-managed workspace files with freshly composed content\n' +
        '  (a tarball backup is written to ~/.bakin/.backups/ first). Proceed?',
      )
      if (!confirmed) {
        return { ok: false, error: 'Migration declined — agent left un-synced.' }
      }
      const migration = await apiPost('/api/agent-packages/migrate', {}) as Record<string, unknown>
      if (!migration.ok) return migration
      const second = await apiPostJson(`/api/agent-packages/${encodeURIComponent(id)}/sync`, body)
      result = second.data as Record<string, unknown>
    }
    return result
  }

  const action = flags.check ? 'checked' : 'synced'

  if (agentId) {
    const result = await syncOne(agentId)
    if (!flags.json && process.stdout.isTTY) {
      await printPackageActionTui({ action, scope: 'agent', target: agentId, result })
      return
    }
    print(result)
    return
  }

  // No agentId — sync every runtime agent (managed agents get the full
  // sequence; unmanaged agents get their context block maintained).
  const list = await apiGet('/api/agent-packages') as {
    agents: Array<{ agentId: string; state: string }>
  }
  const actions: PackageActionData[] = []
  for (const a of list.agents) {
    if (a.state === 'absent') continue
    try {
      const result = await syncOne(a.agentId)
      if (!flags.json && process.stdout.isTTY) {
        actions.push({ action, scope: 'agent', target: a.agentId, result })
        continue
      }
      console.log(`${a.agentId}:`)
      print(result)
    } catch (err) {
      if (!flags.json && process.stdout.isTTY) {
        actions.push({
          action,
          scope: 'agent',
          target: a.agentId,
          result: { ok: false, error: err instanceof Error ? err.message : String(err) },
        })
        continue
      }
      console.error(`${a.agentId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (!flags.json && process.stdout.isTTY) {
    await printPackageActionTui(actions)
  }
}

async function cmdAgentPackagesLessonsList(agentId: string): Promise<void> {
  const result = await apiGet(`/api/agent-packages/${encodeURIComponent(agentId)}/lessons`) as {
    ok: boolean
    packageId: string
    lessons: Array<{ lessonId: string; title: string; tags: string[]; enabled: boolean }>
  }
  if (process.stdout.isTTY) {
    await printAgentLessonsListTui(agentId, result.packageId, result.lessons)
    return
  }
  console.log(`Lessons for ${agentId} (package: ${result.packageId})`)
  for (const l of result.lessons) {
    const mark = l.enabled ? '[x]' : '[ ]'
    const tags = l.tags.length > 0 ? ` (${l.tags.join(', ')})` : ''
    console.log(`  ${mark} ${l.lessonId.padEnd(30)} ${l.title}${tags}`)
  }
}

async function cmdAgentPackagesLessonsToggle(
  agentId: string,
  lessonId: string,
  enabled: boolean,
  opts: { json?: boolean } = {},
): Promise<void> {
  const result = await apiPost(
    `/api/agent-packages/${encodeURIComponent(agentId)}/lessons/${encodeURIComponent(lessonId)}`,
    { enabled },
  )
  if (!opts.json && process.stdout.isTTY) {
    await printPackageActionTui({
      action: enabled ? 'enabled' : 'disabled',
      scope: 'lesson',
      target: lessonId,
      context: agentId,
      result,
    })
    return
  }
  print(result)
}

// ---------------------------------------------------------------------------
// Standalone-pack commands — `bakin packages ...`
// ---------------------------------------------------------------------------

async function cmdPackagesList(flags: AgentsCmdFlags): Promise<void> {
  const result = await apiGet('/api/packages') as {
    ok: boolean
    packages: Array<{
      id: string; kind: string; version: string; refCount: number; dependents: string[]
    }>
  }
  const packages = result.packages.filter(p => p.kind !== 'agent')
  if (flags.json) {
    print({ ...result, packages })
    return
  }
  if (process.stdout.isTTY) {
    await printPackagesListTui(packages)
    return
  }
  console.log('Installed packages:')
  for (const p of packages) {
    const refs = p.refCount > 0 ? `  (refCount=${p.refCount}: ${p.dependents.join(', ')})` : ''
    console.log(`  ${p.id.padEnd(40)} ${p.kind.padEnd(15)} ${p.version}${refs}`)
  }
}

async function cmdPackagesInstall(source: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = { source }
  if (flags.installAs) body.installAs = flags.installAs
  if (flags.replace) body.replace = true
  const result = await apiPost('/api/packages/install', body)
  if (!flags.json && process.stdout.isTTY) {
    await printPackageActionTui({
      action: 'installed',
      scope: 'package',
      target: flags.installAs ?? source,
      result,
    })
    return
  }
  print(result)
}

async function cmdPackagesRemove(packageId: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.keepBlocks) body.keepBlocks = true
  if (flags.force) body.force = true
  const result = await apiDelete(`/api/packages/${encodeURIComponent(packageId)}`, body)
  if (!flags.json && process.stdout.isTTY) {
    await printPackageActionTui({
      action: 'removed',
      scope: 'package',
      target: packageId,
      result,
    })
    return
  }
  print(result)
}

async function cmdPackagesSync(packageId: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.check) body.check = true
  const result = await apiPost(`/api/packages/${encodeURIComponent(packageId)}/sync`, body)
  if (!flags.json && process.stdout.isTTY) {
    await printPackageActionTui({
      action: flags.check ? 'checked' : 'synced',
      scope: 'package',
      target: packageId,
      result,
    })
    return
  }
  print(result)
}

/** Parse a flag-style argv tail (everything after the positional args). */
function parseAgentsFlags(args: string[]): AgentsCmdFlags {
  const flags: AgentsCmdFlags = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    switch (a) {
      case '--adopt':
        flags.adopt = true
        break
      case '--install-as':
        flags.installAs = args[++i]
        break
      case '--replace':
        flags.replace = true
        break
      case '--keep-blocks':
        flags.keepBlocks = true
        break
      case '--delete-agent':
      case '--delete':
        flags.deleteAgent = true
        break
      case '--orphan':
        flags.deleteAgent = false
        break
      case '--check':
        flags.check = true
        break
      case '--reclaim':
        flags.reclaim = [...(flags.reclaim ?? []), args[++i]]
        break
      case '--reclaim-all':
        flags.reclaimAll = true
        break
      case '--yes':
        flags.yes = true
        break
      case '--force':
        flags.force = true
        break
      case '--json':
        flags.json = true
        break
    }
  }
  return flags
}

type CliDoctorResult = {
  results: Array<{ check: string; status: string; message: string }>
  summary: { total: number; errors: number; warnings: number }
  mode?: 'offline' | 'full'
}

type CliDoctorRepairChange = {
  kind: string
  target: string
  action: string
  description: string
}

type CliDoctorRepairPlanItem = {
  id: string
  checkId: string
  healthCheckId?: string
  pluginId?: string
  checkName?: string
  title: string
  reason: string
  safety: 'safe' | 'manual' | 'destructive'
  requiresConfirmation: boolean
  changes: CliDoctorRepairChange[]
}

type CliDoctorRepairPlan = {
  diagnostics: Array<{ check: string; status: string; message: string; autoFixable?: boolean }>
  items: CliDoctorRepairPlanItem[]
  errors: Array<{ phase: string; healthCheckId: string; message: string }>
  summary: {
    diagnostics: number
    repairableChecks: number
    totalItems: number
    safeItems: number
    blockedItems: number
    planErrors: number
  }
}

type CliDoctorRepairApply = {
  status: 'confirmation_required' | 'applied'
  plan: CliDoctorRepairPlan
  applied: Array<{ id: string; checkId: string; status: string; message: string; changes: CliDoctorRepairChange[] }>
  skipped: Array<{ id: string; checkId: string; status: string; message: string; changes: CliDoctorRepairChange[] }>
  errors: Array<{ phase: string; healthCheckId: string; message: string }>
  verification: Array<{ check: string; status: string; message: string; autoFixable?: boolean }>
  summary: {
    planned: number
    applied: number
    skipped: number
    failed: number
    verificationErrors: number
    verificationWarnings: number
  }
}

type CliDoctorDelegateReport = {
  status: 'confirmation_required' | 'sent' | 'no_unresolved'
  request: Record<string, unknown>
  unresolved: Array<{ check: string; status: string; message: string; autoFixable?: boolean }>
}

function summarizeDoctorResults(results: CliDoctorResult['results']): CliDoctorResult['summary'] {
  return {
    total: results.length,
    errors: results.filter(r => r.status === 'error').length,
    warnings: results.filter(r => r.status === 'warn').length,
  }
}

async function runOfflineDoctor(): Promise<CliDoctorResult> {
  const [
    { mkdirComponent },
    { settingsComponent },
    { searchComponent },
    { searchModelsComponent },
    { mcporterComponent },
    { agentSyncComponent },
    { recommendedPluginsComponent },
  ] = await Promise.all([
    import('../src/core/onboarding/mkdir'),
    import('../src/core/onboarding/settings'),
    import('../src/core/onboarding/search'),
    import('../src/core/onboarding/search-models'),
    import('../src/core/onboarding/mcporter'),
    import('../src/core/onboarding/agent-sync'),
    import('../src/core/onboarding/recommended-plugins'),
  ])
  const checks = []
  for (const component of [
    mkdirComponent,
    settingsComponent,
    searchComponent,
    searchModelsComponent,
    mcporterComponent,
    agentSyncComponent,
    recommendedPluginsComponent,
  ]) {
    try {
      checks.push(await component.check())
    } catch (err) {
      checks.push({
        name: component.name,
        status: 'error' as const,
        message: `check() threw: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }
  const results: CliDoctorResult['results'] = checks.map(check => ({
    check: check.name,
    status: check.status === 'ok' ? 'ok' : check.status === 'warn' ? 'warn' : 'error',
    message: check.remediation ? `${check.message} ${check.remediation}` : check.message,
  }))
  results.push({
    check: 'runtime',
    status: 'warn',
    message: 'Skipped live runtime checks in offline mode. Run `bakin doctor --full` after `bakin start` to verify runtime reachability, agents, LLM providers, and channels.',
  })
  results.push({
    check: 'plugin-assets',
    status: 'warn',
    message: 'Skipped runtime skill projection checks in offline mode. Run `bakin doctor --full` after `bakin start` to verify plugin assets.',
  })
  results.push({
    check: 'server-backed-checks',
    status: 'warn',
    message: 'Skipped plugin, search index, workflow, task, and server health checks that require the Bakin server. Run `bakin doctor --full` after `bakin start`.',
  })
  return { results, summary: summarizeDoctorResults(results), mode: 'offline' }
}

async function runFullDoctor(options: { notifyAgent: boolean }): Promise<CliDoctorResult> {
  const query = options.notifyAgent
    ? '/api/plugins/health/doctor?fresh=true&notifyAgent=true'
    : '/api/plugins/health/doctor?fresh=true'
  const result = await apiGet(query) as CliDoctorResult
  return { ...result, mode: 'full' }
}

async function runDoctorRepairPlan(): Promise<CliDoctorRepairPlan> {
  return await apiGet('/api/plugins/health/doctor/repair/plan') as CliDoctorRepairPlan
}

async function runDoctorRepairApply(): Promise<CliDoctorRepairApply> {
  return await apiPost('/api/plugins/health/doctor/repair/apply', { accepted: true }) as CliDoctorRepairApply
}

async function runDoctorDelegateApply(): Promise<CliDoctorDelegateReport> {
  return await apiPost('/api/plugins/health/doctor/delegate', { accepted: true }) as CliDoctorDelegateReport
}

function doctorRepairExitCode(report: CliDoctorRepairApply): 0 | 1 | 2 {
  if (report.summary.failed > 0 || report.summary.verificationErrors > 0 || report.errors.length > 0) return 1
  if (report.summary.verificationWarnings > 0) return 2
  return 0
}

function printDoctorRepairJson(data: unknown, exitCode: 0 | 1 | 2, error: { code: string; message: string } | null = null): void {
  console.log(JSON.stringify({
    ok: error === null && exitCode !== 1,
    command: 'doctor --fix',
    exitCode,
    data,
    error,
  }, null, 2))
}

function printDoctorRepairPlan(plan: CliDoctorRepairPlan): void {
  console.log('Doctor repair plan')
  console.log(`${plan.summary.safeItems} safe, ${plan.summary.blockedItems} blocked, ${plan.summary.planErrors} plan errors`)
  if (plan.items.length === 0) {
    console.log('No deterministic repairs available.')
    return
  }
  for (const item of plan.items) {
    console.log(`\n[${item.safety.toUpperCase()}] ${item.title}`)
    console.log(`  id: ${item.id}`)
    console.log(`  reason: ${item.reason}`)
    for (const change of item.changes) {
      console.log(`  - ${change.action} ${change.target}: ${change.description}`)
    }
  }
}

function printDoctorRepairApply(report: CliDoctorRepairApply): void {
  console.log('Doctor repair results')
  for (const result of report.applied) {
    const label = result.status === 'applied' ? 'APPLIED' : result.status.toUpperCase()
    console.log(`[${label}] ${result.id}: ${result.message}`)
  }
  for (const result of report.skipped) {
    console.log(`[SKIPPED] ${result.id}: ${result.message}`)
  }
  console.log(`\n${report.summary.applied} applied, ${report.summary.skipped} skipped, ${report.summary.failed} failed`)
  if (report.verification.length > 0) {
    console.log(`${report.summary.verificationErrors} verification errors, ${report.summary.verificationWarnings} verification warnings`)
  }
}

function unresolvedDelegateRows(plan: CliDoctorRepairPlan): CliDoctorRepairPlan['diagnostics'] {
  const safeRepairChecks = new Set(
    plan.items
      .filter(item => item.safety === 'safe')
      .map(item => item.checkId),
  )
  return plan.diagnostics.filter(row => (
    (row.status === 'warn' || row.status === 'error')
    && !safeRepairChecks.has(row.check)
  ))
}

function printDoctorDelegatePreview(plan: CliDoctorRepairPlan, unresolved: CliDoctorRepairPlan['diagnostics']): void {
  console.log('Doctor delegated repair preview')
  if (unresolved.length === 0) {
    console.log('No unresolved findings need delegated repair.')
    return
  }
  for (const row of unresolved) {
    console.log(`[${row.status.toUpperCase()}] ${row.check}: ${row.message}`)
  }
}

function printDoctorDelegateResult(report: CliDoctorDelegateReport): void {
  if (report.status === 'no_unresolved') {
    console.log('No unresolved findings need delegated repair.')
    return
  }
  const request = report.request as { id?: string; taskId?: string; agentId?: string }
  console.log(`Delegated doctor repair ${request.id ?? ''}`)
  if (request.taskId) console.log(`Task: ${request.taskId}`)
  if (request.agentId) console.log(`Agent: ${request.agentId}`)
}

async function printDoctorRepairPlanTui(plan: CliDoctorRepairPlan): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/doctor-repair'), (m) => m.DoctorRepairPlan, { plan })
}

async function printDoctorRepairApplyTui(report: CliDoctorRepairApply, opts: { showBrand?: boolean } = {}): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/doctor-repair'), (m) => m.DoctorRepairApplyReport, { report, showBrand: opts.showBrand })
}

async function printDoctorDelegatePreviewTui(unresolved: CliDoctorRepairPlan['diagnostics']): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/doctor-repair'), (m) => m.DoctorDelegatePreview, { unresolved })
}

async function printDoctorDelegateResultTui(report: CliDoctorDelegateReport, opts: { showBrand?: boolean } = {}): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/doctor-repair'), (m) => m.DoctorDelegateResult, { report, showBrand: opts.showBrand })
}

async function printDoctorRepairRequestsTui(requests: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/doctor-repair'), (m) => m.DoctorRepairRequestsReport, { requests })
}

async function printDoctorRepairRequestTui(request: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/doctor-repair'), (m) => m.DoctorRepairRequestReport, { request })
}

async function printDoctorRepairVerifyTui(requestId: string, result: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../src/core/cli/ui/doctor-repair'), (m) => m.DoctorRepairVerifyReport, { requestId, result })
}

async function confirmDoctorRepair(plan: CliDoctorRepairPlan): Promise<boolean> {
  if (plan.summary.safeItems === 0) return false
  return promptYesNo(`Apply ${plan.summary.safeItems} safe repair item${plan.summary.safeItems === 1 ? '' : 's'}?`)
}

async function confirmDoctorDelegate(unresolved: CliDoctorRepairPlan['diagnostics']): Promise<boolean> {
  if (unresolved.length === 0) return false
  return promptYesNo(`Create a delegated repair task for ${unresolved.length} finding${unresolved.length === 1 ? '' : 's'}?`)
}

async function cmdDoctorFix(options: { json: boolean; yes: boolean; isTTY: boolean }): Promise<void> {
  let acceptedInteractively = false
  if (!options.yes) {
    const plan = await runDoctorRepairPlan()
    if (options.json) {
      if (plan.summary.totalItems === 0) {
        printDoctorRepairJson({ status: 'planned', plan }, 0)
        return
      }
      printDoctorRepairJson(
        { status: 'confirmation_required', plan },
        1,
        { code: 'CONFIRMATION_REQUIRED', message: 'Run `bakin doctor --fix --yes` to apply safe deterministic repairs.' },
      )
      process.exit(1)
    }

    if (options.isTTY) {
      await printDoctorRepairPlanTui(plan)
    } else {
      printDoctorRepairPlan(plan)
    }
    if (plan.summary.totalItems === 0) return

    if (!options.isTTY) {
      console.log('\nRun `bakin doctor --fix --yes` to apply safe deterministic repairs.')
      process.exit(1)
    }
    const accepted = await confirmDoctorRepair(plan)
    if (!accepted) {
      console.log('Repair cancelled.')
      process.exit(1)
    }
    acceptedInteractively = true
  }

  const report = await runDoctorRepairApply()
  const exitCode = doctorRepairExitCode(report)
  if (options.json) {
    printDoctorRepairJson(report, exitCode, exitCode === 1
      ? { code: 'DOCTOR_REPAIR_FAILED', message: 'One or more deterministic doctor repairs failed or did not verify.' }
      : null)
    if (exitCode !== 0) process.exit(exitCode)
    return
  }
  if (options.isTTY) {
    if (acceptedInteractively) console.log('')
    await printDoctorRepairApplyTui(report, { showBrand: !acceptedInteractively })
  } else {
    printDoctorRepairApply(report)
  }
  if (exitCode !== 0) process.exit(exitCode)
}

async function cmdDoctorDelegate(options: { json: boolean; yes: boolean; isTTY: boolean }): Promise<void> {
  let acceptedInteractively = false
  if (!options.yes) {
    const plan = await runDoctorRepairPlan()
    const unresolved = unresolvedDelegateRows(plan)
    if (options.json) {
      if (unresolved.length === 0) {
        printDoctorRepairJson({ status: 'no_unresolved', plan, unresolved }, 0)
        return
      }
      printDoctorRepairJson(
        { status: 'confirmation_required', plan, unresolved },
        1,
        { code: 'CONFIRMATION_REQUIRED', message: 'Run `bakin doctor --delegate --yes` to create the delegated repair task.' },
      )
      process.exit(1)
    }

    if (options.isTTY) {
      await printDoctorDelegatePreviewTui(unresolved)
    } else {
      printDoctorDelegatePreview(plan, unresolved)
    }
    if (unresolved.length === 0) return
    if (!options.isTTY) {
      console.log('\nRun `bakin doctor --delegate --yes` to create the delegated repair task.')
      process.exit(1)
    }
    const accepted = await confirmDoctorDelegate(unresolved)
    if (!accepted) {
      console.log('Delegated repair cancelled.')
      process.exit(1)
    }
    acceptedInteractively = true
  }

  const report = await runDoctorDelegateApply()
  if (options.json) {
    printDoctorRepairJson(report, 0)
    return
  }
  if (options.isTTY) {
    if (acceptedInteractively) console.log('')
    await printDoctorDelegateResultTui(report, { showBrand: !acceptedInteractively })
  } else {
    printDoctorDelegateResult(report)
  }
}

function doctorRepairRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function doctorRepairRequestFromResponse(result: unknown): Record<string, unknown> {
  const data = doctorRepairRecord(result) ?? {}
  return doctorRepairRecord(data.request) ?? data
}

function doctorRepairRequestList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => doctorRepairRecord(item) !== null)
    : []
}

async function cmdDoctorRepair(args: string[], options: { json: boolean; isTTY: boolean }): Promise<void> {
  const sub = args[1] ?? 'list'
  if (sub === 'list') {
    const result = await apiGet('/api/plugins/health/doctor/repair') as { requests?: Array<Record<string, unknown>> }
    if (options.json) {
      printDoctorRepairJson(result, 0)
      return
    }
    const requests = doctorRepairRequestList(result.requests)
    if (options.isTTY) {
      await printDoctorRepairRequestsTui(requests)
      return
    }
    if (requests.length === 0) {
      console.log('No doctor repair requests.')
      return
    }
    for (const request of requests) {
      console.log(`${request.id ?? '(unknown)'}  ${request.status ?? 'unknown'}  task=${request.taskId ?? '-'}`)
    }
    return
  }

  if (sub !== 'show' && sub !== 'verify') {
    if (options.isTTY) {
      await exitUnknownSubcommand('doctor repair', sub, ['list', 'show', 'verify'])
    }
    console.error(`Unknown doctor repair subcommand: ${sub}`)
    process.exit(1)
  }

  const requestId = args[2]
  if (!requestId) {
    const usage = `bakin doctor repair ${sub} <request-id>`
    if (options.isTTY) {
      await exitUsage(usage)
    }
    console.error(`Usage: ${usage}`)
    process.exit(1)
  }

  if (sub === 'show') {
    const result = await apiGet(`/api/plugins/health/doctor/repair/${encodeURIComponent(requestId)}`)
    if (options.json) {
      printDoctorRepairJson(result, 0)
      return
    }
    if (options.isTTY) {
      await printDoctorRepairRequestTui(doctorRepairRequestFromResponse(result))
      return
    }
    print(result)
    return
  }

  if (sub === 'verify') {
    const result = await apiPost(`/api/plugins/health/doctor/repair/${encodeURIComponent(requestId)}/verify`)
    if (options.json) {
      printDoctorRepairJson(result, 0)
      return
    }
    if (options.isTTY) {
      await printDoctorRepairVerifyTui(requestId, doctorRepairRecord(result) ?? {})
      return
    }
    print(result)
    return
  }
}

async function cmdDoctor(args: string[] = process.argv.slice(2)): Promise<void> {
  const json = args.includes('--json')
  const full = args.includes('--full')
  const notifyAgent = args.includes('--notify-agent')
  const fix = args.includes('--fix')
  const delegate = args.includes('--delegate')
  const yes = args.includes('--yes')
  const isTTY = Boolean(process.stdout.isTTY)
  if (args[0] === 'repair') {
    await cmdDoctorRepair(args, { json, isTTY })
    return
  }
  if (fix) {
    await cmdDoctorFix({ json, yes, isTTY })
    return
  }
  if (delegate) {
    await cmdDoctorDelegate({ json, yes, isTTY })
    return
  }
  const result = full ? await runFullDoctor({ notifyAgent }) : await runOfflineDoctor()

  if (json) {
    console.log(JSON.stringify({
      ok: result.summary.errors === 0,
      command: 'doctor',
      exitCode: result.summary.errors > 0 ? 1 : result.summary.warnings > 0 ? 2 : 0,
      data: result,
      error: result.summary.errors > 0
        ? { code: 'DOCTOR_ERRORS', message: `${result.summary.errors} doctor check${result.summary.errors === 1 ? '' : 's'} failed` }
        : null,
    }, null, 2))
    if (result.summary.errors > 0) process.exit(1)
    if (result.summary.warnings > 0) process.exit(2)
    return
  }

  if (isTTY) {
    const { DoctorReport } = await import('../src/core/cli/ui/doctor')
    const { renderToString } = await import('../src/core/cli/ui/render-to-string')
    const { createElement } = await import('react')
    console.log(renderToString(createElement(DoctorReport, {
      results: result.results,
      summary: result.summary,
      mode: result.mode,
    })))
    if (result.summary.errors > 0) process.exit(1)
    if (result.summary.warnings > 0) process.exit(2)
    return
  }

  const statusIcon: Record<string, string> = { ok: 'OK', warn: 'WARN', error: 'FAIL', fixed: 'FIXED' }

  for (const r of result.results) {
    const icon = statusIcon[r.status] || r.status
    console.log(`  [${icon}] ${r.check}: ${r.message}`)
  }

  console.log('')
  const { total, errors, warnings } = result.summary
  if (errors > 0) {
    console.log(`${errors} errors, ${warnings} warnings out of ${total} checks`)
  } else if (warnings > 0) {
    console.log(`${warnings} warnings out of ${total} checks`)
  } else {
    console.log(`All ${total} checks passed`)
  }
  if (errors > 0) process.exit(1)
  if (warnings > 0) process.exit(2)
}

// ---------------------------------------------------------------------------
// Agent Rules
// ---------------------------------------------------------------------------

async function cmdPaths(key?: string, opts: { json?: boolean } = {}): Promise<void> {
  const result = await apiGet(`/api/paths${key ? `?key=${encodeURIComponent(key)}` : ''}`) as Record<string, unknown>

  if (opts.json) {
    print(result)
    return
  }

  if (key) {
    if (process.stdout.isTTY) {
      await printPathsTui({ [key]: result.path }, result.isBakinHome)
      return
    }
    // Single path in non-TTY mode prints just the value for scripting.
    console.log(result.path)
  } else {
    const paths = result.paths as Record<string, unknown>
    if (process.stdout.isTTY) {
      await printPathsTui(paths, result.isBakinHome)
      return
    }
    const isHome = result.isBakinHome ? '~/.bakin' : './content (not migrated)'
    console.log(`Content dir: ${isHome}`)
    console.log('')
    for (const [k, v] of Object.entries(paths)) {
      console.log(`  ${k.padEnd(12)} ${v}`)
    }
  }
}

const SERVICE_LABEL = 'com.makinbakin.bakin'
const LEGACY_SERVICE_LABELS = ['com.bakin.mc']

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function systemdEscape(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

interface ServerLaunchSpec {
  programArgs: string[]
  workingDir: string
}

function isBunVirtualPath(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith('/$bunfs/')
}

function currentExecutable(): string {
  for (const candidate of [process.execPath, process.argv[0]]) {
    if (candidate && !isBunVirtualPath(candidate)) return candidate
  }
  return 'bakin'
}

async function resolveServerLaunchSpec(): Promise<ServerLaunchSpec> {
  const { existsSync } = await import('fs')
  const { join, resolve, dirname } = await import('path')
  const argvScript = process.argv[1]
  if (argvScript && !isBunVirtualPath(argvScript) && /\.(ts|js|mjs|cjs)$/.test(argvScript)) {
    const projectDir = resolve(dirname(new URL(import.meta.url).pathname), '..')
    const serverPath = join(projectDir, 'server.ts')
    if (existsSync(serverPath)) {
      return { programArgs: [currentExecutable(), serverPath, 'serve'], workingDir: projectDir }
    }
    return { programArgs: [currentExecutable(), argvScript, 'serve'], workingDir: projectDir }
  }
  const { getBakinPaths } = await import('../packages/core/src/content-dir')
  return { programArgs: [currentExecutable(), 'serve'], workingDir: getBakinPaths().home }
}

function serviceEnvironment(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
  }
  for (const key of ['BAKIN_HOME', 'PORT'] as const) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  return env
}

async function waitForServerVersion(timeoutSeconds = 15): Promise<{ ok: true; version: string } | { ok: false }> {
  for (let i = 0; i < timeoutSeconds; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const res = await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const data = await res.json() as { version?: unknown }
        return { ok: true, version: typeof data.version === 'string' ? data.version : 'unknown' }
      }
    } catch { /* not ready yet */ }
  }
  return { ok: false }
}

function generateLaunchAgentPlist(opts: {
  programArgs: string[]
  environment: Record<string, string>
  workingDir: string
  stdoutPath: string
  stderrPath: string
}): string {
  const args = opts.programArgs.map(arg => `    <string>${xmlEscape(arg)}</string>`).join('\n')
  const env = Object.entries(opts.environment)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(opts.workingDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(opts.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(opts.stderrPath)}</string>
</dict>
</plist>
`
}

function generateSystemdUnit(opts: {
  programArgs: string[]
  environment: Record<string, string>
  workingDir: string
  stdoutPath: string
  stderrPath: string
}): string {
  const env = Object.entries(opts.environment)
    .map(([key, value]) => `Environment=${systemdEscape(`${key}=${value}`)}`)
    .join('\n')
  return `[Unit]
Description=Bakin server
After=network.target

[Service]
Type=simple
WorkingDirectory=${systemdEscape(opts.workingDir)}
ExecStart=${opts.programArgs.map(systemdEscape).join(' ')}
Restart=on-failure
RestartSec=3
${env}
StandardOutput=append:${opts.stdoutPath}
StandardError=append:${opts.stderrPath}

[Install]
WantedBy=default.target
`
}

function serverProcessPattern(): string {
  return 'tsx.*server\\.ts|bun.*server\\.ts.*serve|bakin.*serve'
}

async function cmdStartServer(command: 'start' | 'serve', args: string[] = []): Promise<void> {
  if (command === 'start') {
    const { dispatchCli } = await import('../src/core/cli')
    const result = await dispatchCli(['bun', 'bakin', 'start', ...args])
    if (!result.startServer) {
      process.exitCode = result.exitCode
      return
    }
  }

  const { spawn } = await import('child_process')
  const launch = await resolveServerLaunchSpec()
  const child = spawn(launch.programArgs[0], launch.programArgs.slice(1), {
    cwd: launch.workingDir,
    stdio: 'inherit',
    env: { ...process.env },
  })
  const exitCode = await new Promise<number>((resolvePromise) => {
    child.once('close', (code: number | null) => resolvePromise(code ?? 0))
    child.once('error', async (err: Error) => {
      const detail = err instanceof Error ? err.message : String(err)
      if (process.stdout.isTTY) {
        await printCommandFailureTui({
          command: `bakin ${command}`,
          message: 'Failed to start Bakin.',
          detail,
          code: 'START_FAILED',
        })
      } else {
        console.error('Failed to start Bakin:', detail)
      }
      resolvePromise(1)
    })
  })
  process.exitCode = exitCode
}

async function cmdSetupService(options: { uninstall?: boolean } = {}): Promise<void> {
  const { execFileSync } = await import('child_process')
  const { existsSync, mkdirSync, unlinkSync, writeFileSync } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')
  const { getBakinPaths } = await import('../packages/core/src/content-dir')
  const isTTY = process.stdout.isTTY

  const printServiceResult = async (
    result: Record<string, unknown>,
    detail?: string,
  ): Promise<void> => {
    const action = options.uninstall ? 'disable autostart' : 'enable autostart'
    const message = typeof result.message === 'string' ? result.message : 'Bakin service configuration updated.'
    await printRuntimeActionTui({
      action,
      target: 'Bakin service',
      result,
      message,
      detail,
    })
  }

  const launch = await resolveServerLaunchSpec()
  const environment = serviceEnvironment()
  const paths = getBakinPaths()
  const stdoutPath = join(paths.logs, 'server.out.log')
  const stderrPath = join(paths.logs, 'server.err.log')
  mkdirSync(paths.logs, { recursive: true })

  if (process.platform === 'darwin') {
    const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents')
    const plistPath = join(launchAgentsDir, `${SERVICE_LABEL}.plist`)
    const uid = execFileSync('id', ['-u'], { encoding: 'utf-8' }).trim()
    const removePlist = (path: string) => {
      try { execFileSync('launchctl', ['bootout', `gui/${uid}`, path], { stdio: 'pipe' }) } catch { /* not loaded */ }
      if (existsSync(path)) unlinkSync(path)
    }

    if (options.uninstall) {
      if (!isTTY) console.log('[..] Removing Bakin LaunchAgent...')
      removePlist(plistPath)
      for (const label of LEGACY_SERVICE_LABELS) {
        removePlist(join(launchAgentsDir, `${label}.plist`))
      }
      if (isTTY) {
        await printServiceResult({
          ok: true,
          status: 'ok',
          message: 'Bakin autostart disabled.',
          service: SERVICE_LABEL,
          platform: 'darwin',
        }, `Service: ${SERVICE_LABEL}`)
      } else {
        console.log('[OK] Bakin autostart disabled')
      }
      return
    }

    mkdirSync(launchAgentsDir, { recursive: true })
    removePlist(plistPath)
    for (const label of LEGACY_SERVICE_LABELS) {
      removePlist(join(launchAgentsDir, `${label}.plist`))
    }
    writeFileSync(plistPath, generateLaunchAgentPlist({
      programArgs: launch.programArgs,
      environment,
      workingDir: launch.workingDir,
      stdoutPath,
      stderrPath,
    }), 'utf-8')
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'pipe' })
    execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE_LABEL}`], { stdio: 'pipe' })
    const started = await waitForServerVersion()
    if (!started.ok) process.exitCode = 1
    if (isTTY) {
      await printServiceResult({
        ok: true,
        status: started.ok ? 'ok' : 'warn',
        message: started.ok ? 'Bakin autostart enabled.' : 'Bakin autostart enabled, but the service did not respond.',
        service: SERVICE_LABEL,
        platform: 'darwin',
      }, [
        `Service: ${SERVICE_LABEL}`,
        started.ok ? `Version: ${started.version}` : 'Status: not responding after startup',
        `Logs: ${stdoutPath}`,
        `Errors: ${stderrPath}`,
        'Disable: bakin setup service --uninstall',
      ].join('\n'))
    } else {
      console.log(started.ok ? '[OK] Bakin autostart enabled' : '[WARN] Bakin autostart enabled, but the service did not respond')
      console.log(`  Service: ${SERVICE_LABEL}`)
      if (started.ok) console.log(`  Version: ${started.version}`)
      console.log(`  Logs:    ${stdoutPath}`)
      console.log(`  Errors:  ${stderrPath}`)
      console.log('  Disable: bakin setup service --uninstall')
    }
    return
  }

  if (process.platform === 'linux') {
    const systemdDir = join(homedir(), '.config', 'systemd', 'user')
    const unitPath = join(systemdDir, `${SERVICE_LABEL}.service`)
    if (options.uninstall) {
      if (!isTTY) console.log('[..] Removing Bakin user service...')
      try { execFileSync('systemctl', ['--user', 'disable', '--now', `${SERVICE_LABEL}.service`], { stdio: 'pipe' }) } catch { /* not enabled */ }
      if (existsSync(unitPath)) unlinkSync(unitPath)
      try { execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' }) } catch { /* systemd unavailable */ }
      if (isTTY) {
        await printServiceResult({
          ok: true,
          status: 'ok',
          message: 'Bakin autostart disabled.',
          service: `${SERVICE_LABEL}.service`,
          platform: 'linux',
        }, `Service: ${SERVICE_LABEL}.service`)
      } else {
        console.log('[OK] Bakin autostart disabled')
      }
      return
    }

    mkdirSync(systemdDir, { recursive: true })
    writeFileSync(unitPath, generateSystemdUnit({
      programArgs: launch.programArgs,
      environment,
      workingDir: launch.workingDir,
      stdoutPath,
      stderrPath,
    }), 'utf-8')
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' })
    execFileSync('systemctl', ['--user', 'enable', '--now', `${SERVICE_LABEL}.service`], { stdio: 'pipe' })
    const started = await waitForServerVersion()
    if (!started.ok) process.exitCode = 1
    if (isTTY) {
      await printServiceResult({
        ok: true,
        status: started.ok ? 'ok' : 'warn',
        message: started.ok ? 'Bakin autostart enabled.' : 'Bakin autostart enabled, but the service did not respond.',
        service: `${SERVICE_LABEL}.service`,
        platform: 'linux',
      }, [
        `Service: ${SERVICE_LABEL}.service`,
        started.ok ? `Version: ${started.version}` : 'Status: not responding after startup',
        `Logs: ${stdoutPath}`,
        `Errors: ${stderrPath}`,
        'Disable: bakin setup service --uninstall',
      ].join('\n'))
    } else {
      console.log(started.ok ? '[OK] Bakin autostart enabled' : '[WARN] Bakin autostart enabled, but the service did not respond')
      console.log(`  Service: ${SERVICE_LABEL}.service`)
      if (started.ok) console.log(`  Version: ${started.version}`)
      console.log(`  Logs:    ${stdoutPath}`)
      console.log(`  Errors:  ${stderrPath}`)
      console.log('  Disable: bakin setup service --uninstall')
    }
    return
  }

  const error = `Service management is not supported on ${process.platform}.`
  if (isTTY) {
    await printServiceResult({ ok: false, status: 'fail', error })
  } else {
    console.error(error)
  }
  process.exit(1)
}

async function cmdReboot(): Promise<void> {
  const { execFileSync, spawn } = await import('child_process')
  const { existsSync } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')
  const { getBakinPaths } = await import('../packages/core/src/content-dir')
  const isTTY = process.stdout.isTTY
  const details: string[] = []
  const paths = getBakinPaths()
  const logPath = join(paths.logs, 'server.log')

  const printRestartResult = async (result: Record<string, unknown>): Promise<void> => {
    const message = typeof result.message === 'string' ? result.message : 'Bakin restart request completed.'
    if (isTTY) {
      await printRuntimeActionTui({
        action: 'restart',
        target: 'Bakin server',
        result,
        message,
        detail: details.join('\n'),
      })
      return
    }
    if (result.status === 'warn') console.log(`[WARN] ${message}`)
    else console.log(message)
  }

  if (process.platform === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
    if (existsSync(plistPath)) {
      const uid = execFileSync('id', ['-u'], { encoding: 'utf-8' }).trim()
      if (!isTTY) console.log('[..] Restarting Bakin LaunchAgent...')
      try {
        execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE_LABEL}`], { stdio: 'pipe' })
      } catch {
        details.push('LaunchAgent was not loaded; bootstrapped it before restart.')
        execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'pipe' })
        execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE_LABEL}`], { stdio: 'pipe' })
      }
      details.push(`Service: ${SERVICE_LABEL}`)
      details.push(`Logs: tail -f ${logPath}`)
      if (!isTTY) console.log('[OK] Bakin LaunchAgent restart requested')

      if (!isTTY) console.log('[..] Waiting for server to come up...')
      const started = await waitForServerVersion()
      if (started.ok) {
        if (!isTTY) {
          console.log(`[OK] Bakin is up (${started.version})`)
          return
        }
        details.push(`Version: ${started.version}`)
        await printRestartResult({
          ok: true,
          status: 'ok',
          message: 'Bakin restarted.',
          service: SERVICE_LABEL,
          version: started.version,
        })
        return
      }
      if (!isTTY) {
        console.log('[WARN] Server not responding after 15s - check logs')
        process.exitCode = 1
        return
      }
      process.exitCode = 1
      await printRestartResult({
        ok: true,
        status: 'warn',
        message: 'Server not responding after 15s - check logs.',
        service: SERVICE_LABEL,
      })
      return
    }
  }

  if (process.platform === 'linux') {
    const unitPath = join(homedir(), '.config', 'systemd', 'user', `${SERVICE_LABEL}.service`)
    if (existsSync(unitPath)) {
      if (!isTTY) console.log('[..] Restarting Bakin user service...')
      execFileSync('systemctl', ['--user', 'restart', `${SERVICE_LABEL}.service`], { stdio: 'pipe' })
      details.push(`Service: ${SERVICE_LABEL}.service`)
      details.push(`Logs: tail -f ${logPath}`)
      if (!isTTY) console.log('[OK] Bakin user service restart requested')

      if (!isTTY) console.log('[..] Waiting for server to come up...')
      const started = await waitForServerVersion()
      if (started.ok) {
        if (!isTTY) {
          console.log(`[OK] Bakin is up (${started.version})`)
          return
        }
        details.push(`Version: ${started.version}`)
        await printRestartResult({
          ok: true,
          status: 'ok',
          message: 'Bakin restarted.',
          service: `${SERVICE_LABEL}.service`,
          version: started.version,
        })
        return
      }
      if (!isTTY) {
        console.log('[WARN] Server not responding after 15s - check logs')
        process.exitCode = 1
        return
      }
      process.exitCode = 1
      await printRestartResult({
        ok: true,
        status: 'warn',
        message: 'Server not responding after 15s - check logs.',
        service: `${SERVICE_LABEL}.service`,
      })
      return
    }
  }

  // Kill any running Bakin server processes
  if (!isTTY) console.log('[..] Stopping Bakin server...')
  try {
    const pids = execFileSync('pgrep', ['-f', serverProcessPattern()], { encoding: 'utf-8' }).trim()
    if (pids) {
      let signaled = 0
      for (const pid of pids.split('\n')) {
        if (pid && pid !== String(process.pid)) {
          process.kill(Number(pid), 'SIGTERM')
          signaled++
        }
      }
      details.push(`Sent SIGTERM to ${signaled} process(es).`)
      if (!isTTY) console.log('[OK] Sent SIGTERM to Bakin server')
      if (!isTTY) console.log('[..] Waiting for shutdown...')
      await new Promise(r => setTimeout(r, 2000))
    }
  } catch {
    details.push('No running Bakin process found before restart.')
    if (!isTTY) console.log('[..] No running Bakin process found')
  }

  // Start the server in background
  if (!isTTY) console.log('[..] Starting Bakin server...')
  const launch = await resolveServerLaunchSpec()
  const child = spawn(launch.programArgs[0], launch.programArgs.slice(1), {
    cwd: launch.workingDir,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  })
  child.unref()
  if (child.pid) details.push(`Started process ${child.pid}.`)
  details.push(`Logs: tail -f ${logPath}`)
  if (!isTTY) console.log(`[OK] Bakin starting (pid ${child.pid})`)
  if (!isTTY) console.log(`  Logs: tail -f ${logPath}`)

  // Wait and verify
  if (!isTTY) console.log('[..] Waiting for server to come up...')
  const started = await waitForServerVersion()
  if (started.ok) {
    if (!isTTY) {
      console.log(`[OK] Bakin is up (${started.version})`)
      return
    }
    details.push(`Version: ${started.version}`)
    await printRestartResult({
      ok: true,
      status: 'ok',
      message: 'Bakin restarted.',
      pid: child.pid,
      version: started.version,
    })
    return
  }
  if (!isTTY) {
    console.log('[WARN] Server not responding after 15s - check logs')
    process.exitCode = 1
    return
  }
  process.exitCode = 1
  await printRestartResult({
    ok: true,
    status: 'warn',
    message: 'Server not responding after 15s - check logs.',
    pid: child.pid,
  })
}

interface LogsOptions {
  filter?: string
  json?: boolean
  lines?: number
  follow?: boolean
}

function parseLogsArgs(args: string[]): LogsOptions | { error: string } {
  const options: LogsOptions = { lines: 20, follow: true }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--no-follow') {
      options.follow = false
      continue
    }
    if (arg === '--follow') {
      options.follow = true
      continue
    }
    if (arg.startsWith('--lines=')) {
      const value = Number(arg.split('=')[1])
      if (!Number.isInteger(value) || value < 0) return { error: '--lines must be a non-negative integer' }
      options.lines = value
      continue
    }
    if (arg === '--lines') {
      const value = Number(args[i + 1])
      if (!Number.isInteger(value) || value < 0) return { error: '--lines must be a non-negative integer' }
      options.lines = value
      i++
      continue
    }
    if (arg.startsWith('--')) return { error: `Unknown logs argument: ${arg}` }
    if (options.filter) return { error: `Unexpected logs argument: ${arg}` }
    options.filter = arg
  }
  return options
}

function parseAuditLogLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null
  try {
    const parsed = JSON.parse(line) as unknown
    return jsonObject(parsed)
  } catch {
    return null
  }
}

function auditLogMatches(entry: Record<string, unknown>, filter?: string): boolean {
  if (!filter) return true
  if (filter === 'mcp' || filter === 'rest') return entry.channel === filter
  return entry.agent === filter || entry.channel === filter
}

function summarizeAuditData(data: unknown): string {
  const record = jsonObject(data)
  if (!record) return ''
  return Object.entries(record)
    .slice(0, 4)
    .map(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return `${key}=${value}`
      if (Array.isArray(value)) return `${key}=[${value.length}]`
      if (value && typeof value === 'object') return `${key}={...}`
      return `${key}=null`
    })
    .join(' ')
}

function formatAuditLogRow(entry: Record<string, unknown>): string {
  const ts = typeof entry.ts === 'string' ? entry.ts : ''
  const time = ts.includes('T') ? ts.split('T')[1]?.replace('Z', '').slice(0, 12) ?? ts : ts || '-'
  const event = String(entry.event ?? '-')
  const agent = String(entry.agent ?? '-')
  const channel = entry.channel == null ? '-' : String(entry.channel)
  const summary = summarizeAuditData(entry.data)
  return [
    time.padEnd(14),
    event.padEnd(28),
    agent.padEnd(14),
    channel.padEnd(10),
    summary,
  ].join(' ').trimEnd()
}

async function printLogsHeaderTui(options: {
  auditPath: string
  filter?: string
  lines: number
  follow: boolean
}): Promise<void> {
  const [{ ScreenHeader, SummaryStrip, Section, FindingRows }, { renderToString }, { createElement, Fragment }] = await Promise.all([
    import('../src/core/cli/ui/tui'),
    import('../src/core/cli/ui/render-to-string'),
    import('react'),
  ])
  console.log(renderToString(createElement(Fragment, {}, [
    createElement(ScreenHeader, {
      key: 'header',
      title: 'Logs',
      subtitle: 'Audit event stream',
      meta: `filter: ${options.filter ?? 'all'}`,
    }),
    createElement(SummaryStrip, {
      key: 'summary',
      items: [
        { label: 'recent', value: options.lines, status: 'ok' },
        { label: 'mode', value: options.follow ? 'follow' : 'snapshot', status: options.follow ? 'ready' : 'skip' },
      ],
    }),
    createElement(Section, {
      key: 'source',
      title: 'Source',
      children: createElement(FindingRows, {
        rows: [{
          status: 'ok',
          label: 'audit',
          message: options.auditPath,
          detail: options.follow ? 'Streaming new events. Press Ctrl-C to stop.' : 'Snapshot mode.',
        }],
      }),
    }),
  ])))
}

function printAuditEntry(entry: Record<string, unknown>, options: { json?: boolean }): void {
  if (options.json) {
    console.log(JSON.stringify(entry))
    return
  }
  console.log(formatAuditLogRow(entry))
}

async function cmdLogs(options: LogsOptions = {}): Promise<void> {
  const { spawn } = await import('child_process')
  const { existsSync, readFileSync } = await import('fs')
  const { getBakinPaths } = await import('../packages/core/src/content-dir')
  const auditPath = getBakinPaths().audit
  const lines = options.lines ?? 20
  const follow = options.follow !== false
  const jsonOutput = options.json === true || !process.stdout.isTTY

  if (!existsSync(auditPath)) {
    await exitCommandFailure(`Audit log not found: ${auditPath}`, {
      command: options.filter ? `bakin logs ${options.filter}` : 'bakin logs',
      code: 'AUDIT_LOG_NOT_FOUND',
      next: 'Run `bakin mkdir` to initialize Bakin home.',
      plainLines: [
        `Audit log not found: ${auditPath}`,
        'Is Bakin initialized? Run: bakin mkdir',
      ],
    })
  }

  const emitLine = (line: string) => {
    const entry = parseAuditLogLine(line)
    if (!entry || !auditLogMatches(entry, options.filter)) return
    printAuditEntry(entry, { json: jsonOutput })
  }

  if (!jsonOutput && process.stdout.isTTY) {
    await printLogsHeaderTui({ auditPath, filter: options.filter, lines, follow })
    console.log('RECENT EVENTS')
    console.log('------------')
    console.log(['TIME'.padEnd(14), 'EVENT'.padEnd(28), 'AGENT'.padEnd(14), 'CHANNEL'.padEnd(10), 'SUMMARY'].join(' '))
  }

  const history = lines > 0 ? readFileSync(auditPath, 'utf-8').trimEnd().split('\n').slice(-lines) : []
  for (const line of history) emitLine(line)

  if (!follow) return

  if (!jsonOutput && process.stdout.isTTY) {
    console.log('')
    console.log('LIVE TAIL')
    console.log('---------')
  }

  const child = spawn('tail', ['-f', '-n', '0', auditPath], { stdio: ['ignore', 'pipe', 'inherit'] })
  let buffer = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8')
    const parts = buffer.split(/\r?\n/)
    buffer = parts.pop() ?? ''
    for (const line of parts) emitLine(line)
  })

  // Clean up on exit
  process.on('SIGINT', () => {
    child.kill()
    process.exit(0)
  })

  await new Promise(() => {}) // block until killed
}

async function cmdStop(): Promise<void> {
  const { execFileSync } = await import('child_process')

  const printStopResult = async (result: Record<string, unknown>, detail?: string): Promise<void> => {
    // Antfly dies ONLY after Bakin is down/absent: killing it while a Bakin
    // server still runs would trip that server's takeover supervision, which
    // exists precisely to resurrect a disappeared local instance.
    const antflyPid = await stopAntflyInstance()
    if (antflyPid && !process.stdout.isTTY) console.log(`[OK] Sent SIGTERM to Antfly instance (pid ${antflyPid})`)
    const message = typeof result.message === 'string' ? result.message : 'Bakin stop request completed.'
    if (process.stdout.isTTY) {
      await printRuntimeActionTui({
        action: 'stop',
        target: 'Bakin server',
        result,
        message,
        detail,
      })
      return
    }
    if (message === 'Bakin stopped.') console.log('[OK] Bakin stopped')
    else if (message === 'No running Bakin process found.') console.log('[OK] No running Bakin process found')
    else if (result.status === 'warn') console.log(`[WARN] ${message}`)
    else console.log(message)
    if (detail) console.log(`  ${detail}`)
  }

  // `bakin stop` is one of the EXPLICIT antfly kill paths (the keep-alive
  // lifecycle leaves the child running across routine Bakin restarts, so a
  // routine server SIGTERM never stops it). Kill via the instance sidecar,
  // best-effort — a missing/stale sidecar or dead pid is fine.
  const stopAntflyInstance = async (): Promise<number | null> => {
    try {
      const { getBakinPaths } = await import('../packages/core/src/content-dir')
      const { join } = await import('path')
      const { readFileSync, existsSync, unlinkSync } = await import('fs')
      const sidecarPath = join(getBakinPaths().antfly, 'instance.json')
      if (!existsSync(sidecarPath)) return null
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as { pid?: number | null }
      if (sidecar?.pid) {
        try {
          process.kill(sidecar.pid, 'SIGTERM')
        } catch { /* already gone */ }
      }
      try {
        unlinkSync(sidecarPath)
      } catch { /* best effort */ }
      return sidecar?.pid ?? null
    } catch {
      return null
    }
  }

  if (!process.stdout.isTTY) console.log('[..] Stopping Bakin server...')
  try {
    const pids = execFileSync('pgrep', ['-f', serverProcessPattern()], { encoding: 'utf-8' }).trim()
    if (pids) {
      const signaled: string[] = []
      for (const pid of pids.split('\n')) {
        if (pid && pid !== String(process.pid)) {
          process.kill(Number(pid), 'SIGTERM')
          signaled.push(pid)
        }
      }
      if (!process.stdout.isTTY) console.log('[OK] Sent SIGTERM to Bakin server')

      // Wait and verify it's actually down
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500))
        try {
          await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(1000) })
        } catch {
          await printStopResult({
            ok: true,
            status: 'ok',
            message: 'Bakin stopped.',
            signaled: signaled.length,
          }, signaled.length > 0 ? `Sent SIGTERM to ${signaled.length} process(es).` : undefined)
          return
        }
      }
      await printStopResult({
        ok: true,
        status: 'warn',
        message: 'Server may still be shutting down.',
        signaled: signaled.length,
      }, signaled.length > 0 ? `Sent SIGTERM to ${signaled.length} process(es).` : undefined)
    } else {
      await printStopResult({
        ok: true,
        status: 'ok',
        message: 'No running Bakin process found.',
        signaled: 0,
      })
    }
  } catch {
    await printStopResult({
      ok: true,
      status: 'ok',
      message: 'No running Bakin process found.',
      signaled: 0,
    })
  }
}

// ---------------------------------------------------------------------------
// Plugin-contributed CLI commands
// ---------------------------------------------------------------------------

interface PluginCliCommand {
  name: string
  usage: string
  summary: string
  aliases?: string[]
  dispatch?: {
    type: 'execTool'
    name: string
  } | {
    type: 'apiRoute'
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    path: string
  }
}

interface PluginManifestRow {
  id: string
  contributes?: {
    cliCommands?: PluginCliCommand[]
  }
}

function parsePluginCliValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (value.startsWith('[') || value.startsWith('{')) {
    try { return JSON.parse(value) } catch { return value }
  }
  if (value.includes(',') && !value.includes(' ')) {
    return value.split(',').filter(Boolean)
  }
  return value
}

function parsePluginCliArgs(args: string[]): { flags: Record<string, unknown>; positionals: string[] } {
  const flags: Record<string, unknown> = {}
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const raw = arg.slice(2)
    const eq = raw.indexOf('=')
    if (eq >= 0) {
      flags[raw.slice(0, eq)] = parsePluginCliValue(raw.slice(eq + 1))
      continue
    }
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      flags[raw] = parsePluginCliValue(next)
      i++
    } else {
      flags[raw] = true
    }
  }
  return { flags, positionals }
}

function commandWords(command: PluginCliCommand): string[] {
  const words = command.usage.trim().split(/\s+/)
  return words[0] === 'bakin' ? words.slice(1) : words
}

function isPlaceholder(word: string): boolean {
  return /^<[^>]+>$/.test(word)
}

function placeholderName(word: string): string {
  return word.slice(1, -1).replace(/\?$/, '')
}

function matchPluginCliCommand(command: PluginCliCommand, cmd: string, rawArgs: string[]): Record<string, unknown> | null {
  const usage = commandWords(command)
  const parsed = parsePluginCliArgs(rawArgs)
  const provided = [cmd, ...parsed.positionals]
  let providedIndex = 0

  for (let usageIndex = 0; usageIndex < usage.length; usageIndex++) {
    const word = usage[usageIndex]
    if (word.startsWith('[')) continue
    if (isPlaceholder(word)) break

    const actual = provided[providedIndex]
    if (actual === undefined) {
      if (word === 'list' && providedIndex === 1 && command.name.endsWith(':list')) continue
      return null
    }
    if (actual !== word) return null
    providedIndex++
  }

  const params: Record<string, unknown> = { ...parsed.flags }
  const placeholders = usage.filter(isPlaceholder)
  for (const placeholder of placeholders) {
    const value = provided[providedIndex]
    if (value === undefined) return null
    params[placeholderName(placeholder)] = parsePluginCliValue(value)
    providedIndex++
  }

  return params
}

async function dispatchPluginCliCommand(cmd: string, args: string[]): Promise<boolean> {
  const manifest = await apiGet('/api/plugins/manifest') as { plugins: PluginManifestRow[] }
  const commands = manifest.plugins.flatMap(plugin => plugin.contributes?.cliCommands ?? [])
  for (const command of commands) {
    if (!command.dispatch) continue
    const params = matchPluginCliCommand(command, cmd, args)
    if (!params) continue
    const invocation = invocationCommand([cmd, ...args])

    if (command.dispatch.type === 'execTool') {
      const result = await apiPost(`/api/exec-tools/${encodeURIComponent(command.dispatch.name)}`, {
        params,
        agent: 'cli',
      })
      await printPluginCliCommandResult(invocation, args, result)
      return true
    }

    const result = await api(`/api/plugins/${cmd}${command.dispatch.path}`, {
      method: command.dispatch.method,
      body: command.dispatch.method === 'GET' ? undefined : JSON.stringify(params),
    })
    await printPluginCliCommandResult(invocation, args, result)
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Onboarding CLI handlers
// ---------------------------------------------------------------------------

async function withTtyRuntimeLogsSilenced<T>(
  options: { isTTY: boolean; verbose?: boolean },
  run: () => Promise<T>,
): Promise<T> {
  const previousConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  const shouldSilenceRuntimeLogs = options.isTTY && options.verbose !== true && previousConsoleFormat === undefined
  try {
    if (shouldSilenceRuntimeLogs) process.env.BAKIN_CONSOLE_FORMAT = 'silent'
    return await run()
  } finally {
    if (shouldSilenceRuntimeLogs) delete process.env.BAKIN_CONSOLE_FORMAT
  }
}

async function cmdOnboardingMkdir(options: { json?: boolean } = {}): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const json = options.json === true
  const opts = {
    interactive: isTTY && !json,
    autoApprove: true,
    json,
    checkOnly: false,
    force: false,
  }
  const result = await withTtyRuntimeLogsSilenced({ isTTY }, async () => {
    const { mkdirComponent } = await import('../src/core/onboarding/mkdir')
    return await mkdirComponent.install(opts)
  })
  if (json) {
    console.log(JSON.stringify({ component: result.name, status: result.status, message: result.message, durationMs: result.durationMs }))
  } else if (isTTY) {
    await printOnboardingInstallTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
  }
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboardingSettingsInit(options: { json?: boolean } = {}): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const json = options.json === true
  const opts = {
    interactive: isTTY && !json,
    autoApprove: true,
    json,
    checkOnly: false,
    force: false,
  }
  const result = await withTtyRuntimeLogsSilenced({ isTTY }, async () => {
    const { settingsComponent } = await import('../src/core/onboarding/settings')
    return await settingsComponent.install(opts)
  })
  if (json) {
    console.log(JSON.stringify({ component: result.name, status: result.status, message: result.message, durationMs: result.durationMs }))
  } else if (isTTY) {
    await printOnboardingInstallTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
  }
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboardingCheckSingle(
  target: 'runtime' | 'search' | 'search-models' | 'llm' | 'channels' | 'plugin-assets' | 'agent-sync' | 'recommended-plugins' | 'recommended-agents',
  options: { verbose?: boolean } = {},
): Promise<void> {
  const componentMap: Record<string, () => Promise<{ check(): Promise<import('../src/core/onboarding/types').CheckResult> }>> = {
    runtime: async () => (await import('../src/core/onboarding/runtime')).runtimeComponent,
    search: async () => (await import('../src/core/onboarding/search')).searchComponent,
    'search-models': async () => (await import('../src/core/onboarding/search-models')).searchModelsComponent,
    llm: async () => (await import('../src/core/onboarding/credentials')).llmComponent,
    channels: async () => (await import('../src/core/onboarding/credentials')).channelsComponent,
    'plugin-assets': async () => (await import('../src/core/onboarding/plugin-assets')).pluginAssetsComponent,
    'agent-sync': async () => (await import('../src/core/onboarding/agent-sync')).agentSyncComponent,
    'recommended-plugins': async () => (await import('../src/core/onboarding/recommended-plugins')).recommendedPluginsComponent,
    'recommended-agents': async () => (await import('../src/core/onboarding/recommended-agents')).recommendedAgentsComponent,
  }
  const isTTY = Boolean(process.stdout.isTTY)
  const result = await withTtyRuntimeLogsSilenced({ isTTY, verbose: options.verbose }, async () => {
    const component = await componentMap[target]()
    return await component.check()
  })
  if (isTTY) {
    await printOnboardingCheckTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
    if (result.remediation) console.log(`  → ${result.remediation}`)
  }
  if (result.status === 'missing' || result.status === 'error' || result.status === 'broken') process.exit(1)
  if (result.status === 'warn') process.exit(2)
}

async function cmdOnboardingCheckAll(options: { verbose?: boolean } = {}): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY)
  const results = await withTtyRuntimeLogsSilenced({ isTTY, verbose: options.verbose }, async () => {
    const { checkAll } = await import('../src/core/onboarding/index')
    return await checkAll()
  })
  if (isTTY) {
    await printOnboardingCheckAllTui(results)
  } else {
    for (const r of results) {
      console.log(`${statusIcon(r.status)} ${r.name.padEnd(10)} ${r.message}`)
      if (r.remediation) console.log(`  → ${r.remediation}`)
    }
  }
  const hasError = results.some(r => r.status === 'error' || r.status === 'missing' || r.status === 'broken')
  const hasWarn = results.some(r => r.status === 'warn')
  process.exit(hasError ? 1 : hasWarn ? 2 : 0)
}

async function cmdOnboardingInstallSingle(target: string, args: string[]): Promise<void> {
  const componentMap: Record<string, () => Promise<import('../src/core/onboarding/types').OnboardingComponent>> = {
    search: async () => (await import('../src/core/onboarding/search')).searchComponent,
    'search-models': async () => (await import('../src/core/onboarding/search-models')).searchModelsComponent,
    mcporter: async () => (await import('../src/core/onboarding/mcporter')).mcporterComponent,
    'plugin-assets': async () => (await import('../src/core/onboarding/plugin-assets')).pluginAssetsComponent,
    'agent-sync': async () => (await import('../src/core/onboarding/agent-sync')).agentSyncComponent,
    'recommended-plugins': async () => (await import('../src/core/onboarding/recommended-plugins')).recommendedPluginsComponent,
    'recommended-agents': async () => (await import('../src/core/onboarding/recommended-agents')).recommendedAgentsComponent,
  }
  const isTTY = Boolean(process.stdout.isTTY)
  const autoApprove = args.includes('--yes')
  const json = args.includes('--json')
  const verbose = args.includes('--verbose')
  const opts = {
    interactive: isTTY && !json,
    autoApprove: autoApprove || (!isTTY && !json),
    json,
    checkOnly: false,
    force: false,
  }
  const result = await withTtyRuntimeLogsSilenced({ isTTY, verbose }, async () => {
    const component = await componentMap[target]()
    return await component.install(opts)
  })
  if (json) {
    console.log(JSON.stringify({ component: result.name, status: result.status, message: result.message, durationMs: result.durationMs }))
  } else if (isTTY) {
    await printOnboardingInstallTui(result)
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
  }
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboard(args: string[]): Promise<void> {
  const { runOnboard, isOnboarded, loadState, COMPONENT_ORDER } = await import('../src/core/onboarding/index')
  const { collectOnboardingSelections } = await import('../src/core/cli/onboarding-interactive')
  const { OnboardingAlreadyCompleteReport, OnboardingBusy, OnboardingSummary } = await import('../src/core/cli/ui/onboarding')
  const { render } = await import('ink')
  const { renderToString } = await import('../src/core/cli/ui/render-to-string')
  const { createElement } = await import('react')
  const checkOnly = args.includes('--check')
  const yes = args.includes('--yes')
  const json = args.includes('--json')
  const force = args.includes('--force')
  const verbose = args.includes('--verbose')
  const isTTY = Boolean(process.stdout.isTTY)

  // Early exit for already-onboarded machines unless --force or --check
  if (!force && !checkOnly && isOnboarded()) {
    const state = loadState()
    if (!json && isTTY) {
      console.log(renderToString(createElement(OnboardingAlreadyCompleteReport, { state })))
    } else if (!json) {
      console.log(`[OK] Already onboarded on ${state?.completedAt?.slice(0, 10) ?? 'unknown date'}.`)
      console.log('     Re-run with --force to replay the full flow.')
    } else {
      console.log(JSON.stringify({ status: 'already_onboarded', completedAt: state?.completedAt }))
    }
    process.exit(0)
    return
  }

  const previousConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  if (!verbose && previousConsoleFormat === undefined) {
    process.env.BAKIN_CONSOLE_FORMAT = 'silent'
  }

  const baseOpts = {
    interactive: isTTY && !json && !checkOnly,
    autoApprove: yes || (!isTTY && !json),
    json,
    checkOnly,
    force,
  }
  try {
    const selections = await collectOnboardingSelections(baseOpts)
    const opts = { ...baseOpts, ...selections, interactive: false }
    const busyShowsBrand = !selections.renderedWizardScreens

    let busyFrame = 0
    let busyDetail: string | undefined
    const completedOutcomes: Array<{
      name: string
      status: 'complete' | 'warning' | 'skipped' | 'blocked'
      message: string
    }> = []
    let busyTimer: ReturnType<typeof setInterval> | undefined
    const statusForOutcome = (status: 'ok' | 'warn' | 'skipped' | 'error') => {
      if (status === 'ok') return 'complete'
      if (status === 'warn') return 'warning'
      if (status === 'skipped') return 'skipped'
      return 'blocked'
    }
    const renderBusy = () => createElement(OnboardingBusy, {
      label: 'Running onboarding checks and installs',
      detail: busyDetail,
      frame: busyFrame,
      completed: completedOutcomes,
      totalSteps: COMPONENT_ORDER.length,
      showBrand: busyShowsBrand,
    })
    const busy = isTTY && !json
      ? render(renderBusy())
      : null
    if (busy) {
      busyTimer = setInterval(() => {
        busyFrame += 1
        busy.rerender(renderBusy())
      }, 80)
    }

    let result: Awaited<ReturnType<typeof runOnboard>>
    try {
      result = await runOnboard({
        ...opts,
        onProgress: busy
          ? (detail: string) => {
            busyDetail = detail
            busyFrame += 1
            busy.rerender(renderBusy())
          }
          : undefined,
        onOutcome: busy
          ? (outcome) => {
            completedOutcomes.push({
              name: outcome.name,
              status: statusForOutcome(outcome.finalStatus),
              message: outcome.message,
            })
            busyFrame += 1
            busy.rerender(renderBusy())
          }
          : undefined,
      })
    } finally {
      if (busyTimer) clearInterval(busyTimer)
      busy?.unmount()
    }

    if (!json) {
      if (isTTY) {
        console.log('')
        console.log(renderToString(createElement(OnboardingSummary, {
          outcomes: result.outcomes,
          exitCode: result.exitCode,
          showBrand: !busy,
        })))
      } else {
        console.log('')
        for (const o of result.outcomes) {
          console.log(`${statusIcon(o.finalStatus)} ${o.name.padEnd(10)} ${o.message}`)
          if (o.remediation && (o.finalStatus === 'error' || o.finalStatus === 'warn')) {
            console.log(`  → ${o.remediation}`)
          }
        }
        console.log('')
        if (result.exitCode === 0) {
          console.log('Onboarding complete. Run `bakin start` to launch Bakin.')
        } else if (result.exitCode === 2) {
          console.log('Onboarding finished with warnings. Bakin will start but some features may be limited.')
          console.log('Run `bakin start` to launch Bakin.')
        } else {
          console.log('Onboarding failed. Fix the errors above and rerun `bakin onboard`.')
        }
      }
    }

    process.exit(result.exitCode)
  } finally {
    if (!verbose && previousConsoleFormat === undefined) {
      delete process.env.BAKIN_CONSOLE_FORMAT
    }
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    if (process.stdout.isTTY) await printHelpTui()
    else console.log(USAGE.trim())
    process.exit(0)
  }

  const cmd = args[0]
  const sub = args[1]

  try {
    switch (cmd) {
      case 'version':
      case '--version':
      case '-v':
        if (process.stdout.isTTY) await printVersionTui({ version: APP_VERSION })
        else console.log(APP_VERSION)
        break

      case 'update':
        // Self-update is implemented only in the compiled binary (handled in
        // src/core/cli.ts before delegation reaches here). This source/npm entry
        // can't replace its own executable — guide the user instead of erroring.
        console.log(
          'Self-update is only available in the compiled `bakin` binary (run `bakin update`).\n' +
          'This source/npm invocation does not self-update — update via your install method:\n' +
          '  • Homebrew:        brew upgrade bakin\n' +
          '  • Source checkout: git pull',
        )
        break

      case 'status':
      case 'dispatch':
        await (await import('../src/cli/commands/runtime')).run(args)
        break

      case 'tasks':
        await (await import('../src/cli/commands/tasks')).run(args)
        break

      case 'workflows':
        await (await import('../src/cli/commands/workflows')).run(args)
        break

      case 'agents':
        if (sub === 'list') {
          // `bakin agents list --packages` → package state view
          // `bakin agents list`            → existing runtime view
          if (args.includes('--packages')) {
            await cmdAgentPackagesList(parseAgentsFlags(args.slice(2)))
          } else {
            await cmdAgentsList({ json: args.includes('--json') })
          }
        } else if (sub === 'status') {
          if (!args[2]) await exitUsage('bakin agents status <id>')
          await cmdAgentsStatus(args[2], { json: args.includes('--json') })
        } else if (sub === 'tasks') {
          if (!args[2]) await exitUsage('bakin agents tasks <id>')
          await cmdAgentsTasks(args[2])
        } else if (sub === 'send') {
          if (!args[2] || !args[3]) await exitUsage('bakin agents send <id> <message>')
          await cmdAgentsSend(args[2], args.slice(3).join(' '))
        } else if (sub === 'install') {
          if (!args[2]) await exitUsage('bakin agents install <path|github:user/repo[@ref][#subpath]> [--adopt] [--install-as <id>] [--replace]')
          await cmdAgentPackagesInstall(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'orphan') {
          if (!args[2]) await exitUsage('bakin agents orphan <agent-id> [--keep-blocks] [--force]')
          await cmdAgentPackagesOrphan(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'delete') {
          if (!args[2]) await exitUsage('bakin agents delete <agent-id> [--keep-blocks] [--force]')
          await cmdAgentPackagesDelete(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'remove') {
          if (!args[2]) await exitUsage('bakin agents remove <agent-id> [--keep-blocks] [--delete-agent] [--delete] [--force]')
          await cmdAgentPackagesRemove(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'sync') {
          // `bakin agents sync` (no id) syncs every agent; `bakin agents sync <id>` is targeted
          const id = args[2] && !args[2].startsWith('--') ? args[2] : undefined
          const flagsStart = id ? 3 : 2
          await cmdAgentPackagesSync(id, parseAgentsFlags(args.slice(flagsStart)))
        } else if (sub === 'lessons') {
          const lessonSub = args[2]
          if (lessonSub === 'list') {
            if (!args[3]) await exitUsage('bakin agents lessons list <agent-id>')
            await cmdAgentPackagesLessonsList(args[3])
          } else if (lessonSub === 'enable' || lessonSub === 'disable') {
            if (!args[3] || !args[4]) await exitUsage(`bakin agents lessons ${lessonSub} <agent-id> <lesson-id>`)
            await cmdAgentPackagesLessonsToggle(args[3], args[4], lessonSub === 'enable', { json: args.includes('--json') })
          } else {
            await exitUnknownSubcommand('agents lessons', lessonSub, ['list', 'enable', 'disable'])
          }
        } else {
          await exitUnknownSubcommand('agents', sub, ['list', 'status', 'tasks', 'send', 'install', 'orphan', 'delete', 'remove', 'update', 'lessons'])
        }
        break

      case 'settings':
        if (sub === 'get') {
          const flags = args.slice(2)
          const key = flags.find(arg => !arg.startsWith('--'))
          await cmdSettingsGet(key, { json: flags.includes('--json') })
        } else if (sub === 'set') {
          if (!args[2] || !args[3]) await exitUsage('bakin settings set <key> <value>')
          await cmdSettingsSet(args[2], args[3], { json: args.slice(4).includes('--json') })
        } else if (sub === 'init') {
          await cmdOnboardingSettingsInit({ json: args.slice(2).includes('--json') })
        } else {
          await exitUnknownSubcommand('settings', sub, ['get', 'set', 'init'])
        }
        break

      case 'diagnostics':
        if (sub === 'startup') {
          await cmdDiagnosticsStartup(args[2], args.slice(3))
        } else {
          await exitUnknownSubcommand('diagnostics', sub, ['startup'])
        }
        break

      case 'plugins':
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
        } else {
          await exitUnknownSubcommand('plugins', sub, ['list', 'install', 'export', 'import', 'remove', 'upgrade', 'restore', 'link', 'unlink', 'scaffold'])
        }
        break

      case 'packages':
        if (sub === 'install') {
          if (!args[2]) await exitUsage('bakin packages install <path|github:user/repo[@ref][#subpath]> [--install-as <id>] [--replace]')
          await cmdPackagesInstall(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'list') {
          await cmdPackagesList(parseAgentsFlags(args.slice(2)))
        } else if (sub === 'remove') {
          if (!args[2]) await exitUsage('bakin packages remove <package-id> [--force] [--keep-blocks]')
          await cmdPackagesRemove(args[2], parseAgentsFlags(args.slice(3)))
        } else if (sub === 'sync') {
          if (!args[2]) await exitUsage('bakin packages sync <package-id> [--check]')
          await cmdPackagesSync(args[2], parseAgentsFlags(args.slice(3)))
        } else {
          await exitUnknownSubcommand('packages', sub, ['install', 'list', 'remove', 'sync'])
        }
        break

      case 'stop':
        await cmdStop()
        break

      case 'logs':
        {
          const logsOptions = parseLogsArgs(args.slice(1))
          if ('error' in logsOptions) {
            await exitCommandIssue(logsOptions.error, {
              command: 'bakin logs',
              usage: 'bakin logs [filter] [--json] [--lines <n>] [--no-follow]',
            })
          } else {
            await cmdLogs(logsOptions)
          }
        }
        break

      case 'setup':
        if (sub === 'service') {
          const uninstall = args.includes('--uninstall')
          await cmdSetupService({ uninstall })
        } else {
          await exitUnknownSubcommand('setup', sub, ['service'])
        }
        break

      case 'paths':
        {
          const flags = args.slice(1)
          const key = flags.find(arg => !arg.startsWith('--'))
          await cmdPaths(key, { json: flags.includes('--json') })
        }
        break

      case 'mkdir':
        await cmdOnboardingMkdir({ json: args.includes('--json') })
        break

      case 'check':
        if (sub === 'runtime' || sub === 'search' || sub === 'search-models' || sub === 'llm' || sub === 'channels' || sub === 'plugin-assets' || sub === 'agent-sync' || sub === 'recommended-plugins' || sub === 'recommended-agents') {
          await cmdOnboardingCheckSingle(sub, { verbose: args.includes('--verbose') })
        } else if (sub === 'all') {
          await cmdOnboardingCheckAll({ verbose: args.includes('--verbose') })
        } else {
          await exitUnknownSubcommand('check', sub, ['runtime', 'search', 'search-models', 'llm', 'channels', 'plugin-assets', 'agent-sync', 'recommended-plugins', 'recommended-agents', 'all'])
        }
        break

      case 'install':
        if (sub === 'search' || sub === 'search-models' || sub === 'mcporter' || sub === 'plugin-assets' || sub === 'agent-sync' || sub === 'recommended-plugins' || sub === 'recommended-agents') {
          await cmdOnboardingInstallSingle(sub, args)
        } else {
          await exitUnknownSubcommand('install', sub, ['search', 'search-models', 'mcporter', 'plugin-assets', 'agent-sync', 'recommended-plugins', 'recommended-agents'])
        }
        break

      case 'onboard':
        await cmdOnboard(args)
        break

      case 'doctor':
        await cmdDoctor(args.slice(1))
        break

      case 'dev': {
        // Delegate to the unified cmdDev in src/core/cli.ts so the source-
        // tree detection + spawn logic lives in one place (and the
        // compiled binary's `bakin dev` uses the same code path).
        const { cmdDev } = await import('../src/core/cli')
        process.exit(await cmdDev(args.slice(1)))
        break  // unreachable, but eslint's no-fallthrough doesn't know that
      }

      case 'start':
        await cmdStartServer('start', args.slice(1))
        break

      case 'serve':
        await cmdStartServer('serve', args.slice(1))
        break

      case 'reboot':
      case 'restart':
        await cmdReboot()
        break

      case 'assets':
        await (await import('../src/cli/commands/assets')).run(args)
        break

      case 'reindex':
        await (await import('../src/cli/commands/search')).run(args)
        break

      case 'docs':
        await (await import('../src/cli/commands/docs')).run(args)
        break

      case 'search':
      case 'search:stats':
        await (await import('../src/cli/commands/search')).run(args)
        break

      case 'trash':
        await (await import('../src/cli/commands/trash')).run(args)
        break

      case 'schedule':
        await (await import('../src/cli/commands/schedule')).run(args)
        break

      default: {
        let pluginLookupError: string | undefined
        if (!BINARY_ONLY_COMMANDS.has(cmd)) {
          try {
            if (await dispatchPluginCliCommand(cmd, args.slice(1))) {
              break
            }
          } catch (err) {
            if (!isServerConnectionError(err)) throw err
            pluginLookupError = `Plugin command lookup skipped because Bakin is not reachable at ${BASE_URL}.`
          }
        }
        if (process.stdout.isTTY) {
          await printHelpTui(`Unknown command: ${cmd}`, pluginLookupError)
        } else {
          console.error(`Unknown command: ${cmd}`)
          if (pluginLookupError) console.error(pluginLookupError)
          console.log(USAGE.trim())
        }
        process.exit(1)
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'BakinDelegatedCliExit') {
      throw err
    }
    if (err instanceof Error && /^exit:\d+$/.test(err.message)) {
      throw err
    }
    if (
      isServerConnectionError(err)
    ) {
      if (process.stdout.isTTY) {
        await printCommandFailureTui({
          command: invocationCommand(args),
          message: 'Cannot connect to Bakin. Is the server running?',
          detail: `Tried: ${BASE_URL}`,
          code: 'SERVER_UNREACHABLE',
          next: 'Run `bakin start` to launch the server.',
        })
      } else {
        console.error('Error: Cannot connect to Bakin. Is the server running?')
        console.error(`  Tried: ${BASE_URL}`)
        console.error(`  Run \`bakin start\` to launch the server.`)
      }
    } else {
      const message = err instanceof Error ? err.message : String(err)
      if (process.stdout.isTTY) {
        await printCommandFailureTui({
          command: invocationCommand(args),
          message,
          code: 'COMMAND_FAILED',
        })
      } else {
        console.error('Error:', message)
      }
    }
    process.exit(1)
  }
}

// Only auto-invoke when this file is the entry point (npm-linked
// `/opt/homebrew/bin/bakin` shell invocation). When imported from the
// compiled binary's src/core/cli.ts to delegate unknown commands,
// import.meta.main is false and the binary's dispatcher drives us.
if (import.meta.main) {
  main()
}
