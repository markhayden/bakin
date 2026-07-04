/**
 * `bakin packages {install,list,remove,sync}` — standalone content packs
 * (skill/workflow/lesson packs). Relocated verbatim from cli/bakin.ts
 * (B5.3 command-module split). Shares AgentsCmdFlags / parseAgentsFlags /
 * printPackageActionTui with the agents command module.
 */
import { apiGet, apiPost, apiDelete } from '../http'
import { print } from '../output'
import { exitUsage, exitUnknownSubcommand } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import { parseAgentsFlags, printPackageActionTui, type AgentsCmdFlags } from './agents'

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

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
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
}
