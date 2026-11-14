/**
 * `bakin packages {install,list,remove,sync}` — standalone content packs
 * (skill/workflow/lesson packs). Relocated verbatim from cli/bakin.ts
 * (B5.3 command-module split). Shares AgentsCmdFlags / parseAgentsFlags /
 * printPackageActionTui with the agents command module.
 */
import { apiGet, apiPost, apiDelete } from '../http'
import { exitOnFailure, operationBody, startAndFollow } from '../operation-command'
import { currentOperationMode } from '../operation-mode'
import { print } from '../output'
import { exitUsage, exitUnknownSubcommand, promptYesNo } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { PackInstallPreviewData } from '../../core/cli/ui/reports/capability'
import type { CapabilityReadiness } from '../../core/agent-packages/capability-readiness'
import { resolveLocalSource } from '../local-source'
import { parseAgentsFlags, printPackageActionTui, withSilentLogsIf, type AgentsCmdFlags } from './agents'

function isBareName(source: string): boolean {
  return !source.includes(':') && !source.startsWith('./') && !source.startsWith('../')
    && !source.startsWith('/') && !source.startsWith('~/')
}

/** Guided key step (story 3): offer to store each missing secretSlot-backed secret. */
export async function promptMissingSecrets(cap: CapabilityReadiness): Promise<boolean> {
  let storedAny = false
  for (const secret of cap.secrets) {
    if (secret.status !== 'missing' || !secret.secretSlot) continue
    const readline = await import('node:readline/promises')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      if (secret.help) console.log(`  ${secret.name}: get one at ${secret.help}`)
      const value = (await rl.question(`  Paste ${secret.name} (Enter to skip): `)).trim()
      if (!value) continue
      const dot = secret.secretSlot.indexOf('.')
      const provider = secret.secretSlot.slice(0, dot)
      const name = secret.secretSlot.slice(dot + 1)
      await apiPost('/api/secrets', { provider, name, value })
      storedAny = true
      console.log(`  ✓ stored as ${secret.secretSlot} (Settings → Integrations & Keys)`)
    } finally {
      rl.close()
    }
  }
  return storedAny
}

/** The pack's per-leg readiness (the ONE readiness engine's answer) as a TUI screen. */
export async function printCapabilityStatus(cap: CapabilityReadiness): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/reports/capability'), (m) => m.CapabilityStatusReport, { cap })
}

async function printPackagesListTui(packages: Array<Record<string, unknown>>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.PackagesListReport, { packages })
}

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

/**
 * What a pack declares, read before consent. A local source's manifest is
 * read here, at the same absolute path the server will install from; a
 * remote source is fetched only by the install, so its requirements are
 * listed in the readiness screen afterwards.
 */
export async function previewInstallRequirements(source: string, origin: string): Promise<PackInstallPreviewData> {
  const empty = { source, origin, skills: [], bins: [], npm: [], models: [], prereqs: [], logins: [] }
  if (isBareName(source) || !source.startsWith('/')) return { ...empty, manifest: 'remote' }
  const { readFileSync } = await import('fs')
  const { join } = await import('path')
  const { safeParseManifest } = await import('../../../packages/core/src/agent-packages/manifest')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(source, 'bakin-package.json'), 'utf-8'))
  } catch (err) {
    return { ...empty, manifest: 'unreadable', problem: err instanceof Error ? err.message : String(err) }
  }
  const parsed = safeParseManifest(raw)
  if (!parsed.success) {
    return { ...empty, manifest: 'unreadable', problem: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  const manifest = parsed.data
  const base = { ...empty, manifest: 'read' as const, name: manifest.name, version: manifest.version, description: manifest.description }
  if (manifest.kind !== 'skill-pack') return base
  const { binPlatformKey } = await import('../../core/agent-packages/bin-platform')
  const platform = binPlatformKey()
  return {
    ...base,
    skills: manifest.contributions.skills.map((path) => path.split('/').pop() ?? path),
    bins: (manifest.requires?.bins ?? []).flatMap((bin) => {
      const download = platform ? bin.install[platform] : undefined
      return download ? [{ name: bin.name, version: bin.version, host: new URL(download.url).host }] : []
    }),
    npm: (manifest.requires?.npm ?? []).map((npm) => ({ name: npm.name, dependencies: Object.keys(npm.dependencies).length })),
    models: (manifest.requires?.models ?? []).map((model) => ({ name: model.name, bytes: model.bytes })),
    prereqs: (manifest.requires?.prereqs ?? []).map((prereq) => ({ name: prereq.name, optional: prereq.optional })),
    logins: (manifest.requires?.login ?? []).map((login) => ({ name: login.name, probe: login.probe.join(' '), setup: login.setup })),
  }
}

async function cmdPackagesInstall(typed: string, flags: AgentsCmdFlags, yes: boolean): Promise<void> {
  const source = resolveLocalSource(typed)
  // Consent (story 3): say what installs from where before any write —
  // including declared downloads, so a 900 MB model is never a surprise.
  if (!yes && !flags.json && process.stdout.isTTY) {
    const origin = isBareName(source) ? `the curated catalog ("${source}", pinned source)` : source
    const preview = await previewInstallRequirements(source, origin)
    await renderInkReport(() => import('../../core/cli/ui/reports/capability'), (m) => m.PackInstallConsentReport, { preview })
    if (!(await promptYesNo('Install it?'))) {
      console.log('Aborted — nothing installed.')
      return
    }
  }
  const body: Record<string, unknown> = { source }
  if (flags.installAs) body.installAs = flags.installAs
  if (flags.replace) body.replace = true
  const operation = await startAndFollow(() => apiPost('/api/packages/install', body), { json: Boolean(flags.json) })
  const result = operationBody(operation) as Record<string, unknown> & {
    ok?: boolean
    capability?: CapabilityReadiness
  }

  if (flags.json || !process.stdout.isTTY) {
    print(result)
    exitOnFailure(operation)
    return
  }
  exitOnFailure(operation)

  // Capability packs get the per-leg status + guided key step instead of the
  // generic TUI card.
  if (result.ok && result.capability) {
    await printCapabilityStatus(result.capability)
    if (!result.capability.ready && (await promptMissingSecrets(result.capability))) {
      const refreshed = await apiGet('/api/packages/capabilities') as { capabilities: CapabilityReadiness[] }
      const cap = refreshed.capabilities.find((c) => c.capability === result.capability!.capability)
      if (cap) await printCapabilityStatus(cap)
    }
    return
  }

  await printPackageActionTui({
    action: 'installed',
    scope: 'package',
    target: flags.installAs ?? typed,
    result,
  })
}

async function cmdPackagesRemove(packageId: string, flags: AgentsCmdFlags): Promise<void> {
  const body: Record<string, unknown> = {}
  if (flags.keepBlocks) body.keepBlocks = true
  if (flags.force) body.force = true
  const operation = await startAndFollow(() => apiDelete(`/api/packages/${encodeURIComponent(packageId)}`, body), { json: Boolean(flags.json) })
  const result = operationBody(operation)
  if (!flags.json && process.stdout.isTTY) {
    exitOnFailure(operation)
    await printPackageActionTui({
      action: 'removed',
      scope: 'package',
      target: packageId,
      result,
    })
    return
  }
  print(result)
  exitOnFailure(operation)
}

/** `--check` with no server: the read-only `checkPack` (the route's check) in-process — report-only, nothing persisted (review r2 #9). */
async function checkPackageInProcess(packageId: string, flags: AgentsCmdFlags): Promise<void> {
  const { checkPack } = await import('../../core/agent-packages/sync')
  const result = await withSilentLogsIf(Boolean(flags.json), async (): Promise<Record<string, unknown>> => {
    try {
      return { ok: true, receipt: await checkPack(packageId) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  if (!flags.json && process.stdout.isTTY) await printPackageActionTui({ action: 'checked', scope: 'package', target: packageId, result })
  else print(result)
  if (result.ok === false) process.exit(1)
}

async function cmdPackagesSync(packageId: string, flags: AgentsCmdFlags): Promise<void> {
  if (flags.check && currentOperationMode().kind === 'local') { await checkPackageInProcess(packageId, flags); return }
  const body: Record<string, unknown> = {}
  if (flags.check) body.check = true
  const operation = await startAndFollow(() => apiPost(`/api/packages/${encodeURIComponent(packageId)}/sync`, body), { json: Boolean(flags.json) })
  const result = operationBody(operation)
  if (!flags.json && process.stdout.isTTY) {
    exitOnFailure(operation)
    await printPackageActionTui({
      action: flags.check ? 'checked' : 'synced',
      scope: 'package',
      target: packageId,
      result,
    })
    return
  }
  print(result)
  exitOnFailure(operation)
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (sub === 'install') {
    if (!args[2]) await exitUsage('bakin packages install <name|path|github:user/repo[@ref][#subpath]> [--install-as <id>] [--replace] [--yes]')
    const rest = args.slice(3)
    const yes = rest.includes('--yes') || rest.includes('-y')
    await cmdPackagesInstall(args[2], parseAgentsFlags(rest.filter(a => a !== '--yes' && a !== '-y')), yes)
  } else if (sub === 'list') {
    await cmdPackagesList(parseAgentsFlags(args.slice(2)))
  } else if (sub === 'remove') {
    if (!args[2]) await exitUsage('bakin packages remove <package-id> [--force] [--keep-blocks]')
    await cmdPackagesRemove(args[2], parseAgentsFlags(args.slice(3)))
  } else if (sub === 'sync') {
    if (!args[2]) await exitUsage('bakin packages sync <package-id> [--check]')
    await cmdPackagesSync(args[2], parseAgentsFlags(args.slice(3)))
  } else if (sub === 'login-check') {
    if (!args[2]) await exitUsage('bakin packages login-check <id>')
    await cmdPackagesLoginCheck(args[2]!, parseAgentsFlags(args.slice(3)))
  } else {
    await exitUnknownSubcommand('packages', sub, ['install', 'list', 'remove', 'sync', 'login-check'])
  }
}

interface LoginCheckReceiptRow { name: string; setup: string; status: 'ok' | 'missing' | 'unknown'; reason?: string; account?: string; checkedAt: string }

/** `bakin packages login-check <id>` — run the pack's login probe now and say what it found. */
async function cmdPackagesLoginCheck(id: string, flags: AgentsCmdFlags): Promise<void> {
  const body = await apiPost('/api/packages/login-check', { packageId: id }) as { ok: boolean; error?: string; receipts?: LoginCheckReceiptRow[] }
  if (flags.json) {
    print(body)
    if (!body.ok || (body.receipts ?? []).some((r) => r.status !== 'ok')) process.exit(1)
    return
  }
  if (!body.ok) {
    console.error(body.error ?? 'login check failed')
    process.exit(1)
  }
  const receipts = body.receipts ?? []
  const allOk = receipts.every((r) => r.status === 'ok')
  if (process.stdout.isTTY) {
    await renderInkReport(() => import('../../core/cli/ui/reports/capability'), (m) => m.LoginCheckReport, { packageId: id, receipts })
    if (!allOk) process.exit(1)
    return
  }
  const { loginReasonText } = await import('../../core/cli/ui/reports/login-reason')
  for (const r of receipts) {
    if (r.status === 'ok') console.log(`✓ ${r.name}: logged in${r.account ? ` as ${r.account}` : ''}`)
    else if (r.status === 'missing') console.log(`✗ ${r.name}: needs login — run: ${r.setup}`)
    else console.log(`? ${r.name}: login not verified — ${loginReasonText(r.reason)}`)
  }
  if (!allOk) process.exit(1)
}
