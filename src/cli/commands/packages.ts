/**
 * `bakin packages {install,list,remove,sync}` — standalone content packs
 * (skill/workflow/lesson packs). Relocated verbatim from cli/bakin.ts
 * (B5.3 command-module split). Shares AgentsCmdFlags / parseAgentsFlags /
 * printPackageActionTui with the agents command module.
 */
import { apiGet, apiPost, apiDelete } from '../http'
import { print } from '../output'
import { exitUsage, exitUnknownSubcommand, promptYesNo } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import { parseAgentsFlags, printPackageActionTui, type AgentsCmdFlags } from './agents'

export interface InstallCapabilityInfo {
  capability: string
  name: string
  ready: boolean
  missing: string[]
  skills: Array<{ name: string; status: string }>
  bins: Array<{ name: string; status: string }>
  secrets: Array<{ name: string; required: boolean; secretSlot?: string; help?: string; status: string }>
}

function isBareName(source: string): boolean {
  return !source.includes(':') && !source.startsWith('./') && !source.startsWith('../')
    && !source.startsWith('/') && !source.startsWith('~/')
}

function legLine(ok: boolean, label: string): string {
  return `  ${ok ? '✓' : '⚠'} ${label}`
}

/** Guided key step (story 3): offer to store each missing secretSlot-backed secret. */
export async function promptMissingSecrets(cap: InstallCapabilityInfo): Promise<boolean> {
  let storedAny = false
  for (const secret of cap.secrets) {
    if (secret.status !== 'missing' || !secret.secretSlot) continue
    const readline = await import('node:readline/promises')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      if (secret.help) console.log(`  ${secret.name}: get one at ${secret.help}`)
      const value = (await rl.question(`  Paste ${secret.name} (Enter to skip): `)).trim()
      if (!value) continue
      const [provider, name] = secret.secretSlot.split('.', 2)
      await apiPost('/api/secrets', { provider, name, value })
      storedAny = true
      console.log(`  ✓ stored as ${secret.secretSlot} (Settings → Integrations & Keys)`)
    } finally {
      rl.close()
    }
  }
  return storedAny
}

export function printCapabilityStatus(cap: InstallCapabilityInfo): void {
  console.log(`\nCapability: ${cap.name} (${cap.capability})`)
  for (const s of cap.skills) console.log(legLine(s.status === 'ok', `skill ${s.name}`))
  for (const b of cap.bins) console.log(legLine(b.status === 'ok', `binary ${b.name}`))
  for (const s of cap.secrets) {
    console.log(legLine(s.status !== 'missing', `${s.name} (${s.status === 'missing' ? 'not configured' : s.status})`))
  }
  console.log(cap.ready ? '✓ READY — agents can use this capability now.' : '⚠ Not ready yet:')
  if (!cap.ready) for (const line of cap.missing) console.log(`  - ${line}`)
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
 * Best-effort pre-consent download preview. Local-path sources read the
 * manifest directly; remote sources fall back to the generic consent text
 * (their requirements print in the post-install capability status).
 */
async function previewInstallRequirements(source: string): Promise<string[]> {
  const { existsSync, readFileSync } = await import('fs')
  const { join } = await import('path')
  const manifestPath = join(source, 'bakin-package.json')
  if (!existsSync(manifestPath)) return []
  const { safeParseManifest } = await import('../../../packages/core/src/agent-packages/manifest')
  const parsed = safeParseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
  if (!parsed.success || parsed.data.kind !== 'skill-pack') return []
  const lines: string[] = []
  for (const model of parsed.data.requires?.models ?? []) {
    lines.push(`Downloads model "${model.name}" (${Math.round(model.bytes / 1e6)} MB) into ~/.bakin/models.`)
  }
  for (const prereq of parsed.data.requires?.prereqs ?? []) {
    lines.push(`Needs ${prereq.name} installed${prereq.optional ? ' (optional)' : ''} — checked, never auto-installed.`)
  }
  return lines
}

async function cmdPackagesInstall(source: string, flags: AgentsCmdFlags, yes: boolean): Promise<void> {
  // Consent (story 3): say what installs from where before any write —
  // including declared downloads, so a 900 MB model is never a surprise.
  if (!yes && !flags.json && process.stdout.isTTY) {
    const origin = isBareName(source) ? `"${source}" from the curated catalog (pinned source)` : source
    console.log(`This installs ${origin}: skill content projected to the active runtime,`)
    console.log('plus any pinned binaries into ~/.bakin/bin and declared npm dependencies')
    console.log('into ~/.bakin/npm. Scripts run as agent shell commands.')
    try {
      const preview = await previewInstallRequirements(source)
      for (const line of preview) console.log(line)
    } catch { /* preview is best-effort — consent text above still covers the install */ }
    if (!(await promptYesNo('Proceed? [y/N] '))) {
      console.log('Aborted — nothing installed.')
      return
    }
  }
  const body: Record<string, unknown> = { source }
  if (flags.installAs) body.installAs = flags.installAs
  if (flags.replace) body.replace = true
  const result = await apiPost('/api/packages/install', body) as Record<string, unknown> & {
    ok?: boolean
    capability?: InstallCapabilityInfo
  }

  if (flags.json || !process.stdout.isTTY) {
    print(result)
    return
  }

  // Capability packs get the per-leg status + guided key step instead of the
  // generic TUI card.
  if (result.ok && result.capability) {
    printCapabilityStatus(result.capability)
    if (!result.capability.ready && (await promptMissingSecrets(result.capability))) {
      const refreshed = await apiGet('/api/packages/capabilities') as { capabilities: InstallCapabilityInfo[] }
      const cap = refreshed.capabilities.find((c) => c.capability === result.capability!.capability)
      if (cap) printCapabilityStatus(cap)
    }
    return
  }

  await printPackageActionTui({
    action: 'installed',
    scope: 'package',
    target: flags.installAs ?? source,
    result,
  })
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
  } else {
    await exitUnknownSubcommand('packages', sub, ['install', 'list', 'remove', 'sync'])
  }
}
