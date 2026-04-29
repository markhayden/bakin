/**
 * Backfill `contributes` on in-repo plugin manifests by introspecting source.
 *
 * For each plugins/<id>/bakin-plugin.json this script:
 *   1. Scans the plugin's source for `ctx.registerRoute({...})` calls and
 *      writes them into `contributes.apiRoutes`.
 *   2. Scans for `name: 'bakin_exec_<id>_*'` registrations and writes them
 *      into `contributes.execTools`.
 *   3. Walks `src/core/cli/registry.ts` and copies commands matched by the
 *      plugin's CLI prefix map into `contributes.cliCommands` (with
 *      dispatch={ type: 'execTool' } when the command name maps to a known
 *      exec tool, otherwise an apiRoute dispatch is omitted — the registry
 *      retains the original handler).
 *   4. Adds `docs.slug` pointing at the canonical `using/<id>` page.
 *
 * Re-run it any time source registrations change. The validator will catch
 * drift between manifest and source.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLI_COMMANDS } from '../../src/core/cli/registry'
import {
  extractApiRoutes,
  extractExecTools,
  repoRoot,
  type ApiRouteContribution,
  type CliCommandContribution,
  type ExecToolContribution,
} from './source-scan'

interface PluginPlan {
  id: string
  /** Marker used to filter exec-tool prefixes when it differs from the id. */
  execToolMarker?: string
  /** CLI command name prefixes from `src/core/cli/registry.ts`. */
  cliPrefixes: string[]
  /** Optional explicit settings to declare. */
  settings?: { key: string; summary: string }[]
}

const PLAN: PluginPlan[] = [
  { id: 'tasks', cliPrefixes: ['tasks '] },
  { id: 'workflows', cliPrefixes: ['workflows '] },
  { id: 'schedule', cliPrefixes: ['schedule'] },
  { id: 'team', cliPrefixes: ['agents '] },
  { id: 'health', cliPrefixes: ['doctor', 'status'] },
  { id: 'memory', cliPrefixes: [] },
  { id: 'models', cliPrefixes: [] },
  { id: 'assets', cliPrefixes: ['trash'] },
]

function pluginRouteContributions(pluginId: string): ApiRouteContribution[] {
  return extractApiRoutes()
    .filter(r => r.pluginId === pluginId)
    .map(({ method, path, summary }) => ({ method, path, summary }))
}

function pluginExecToolContributions(pluginId: string, marker?: string): ExecToolContribution[] {
  const prefix = `bakin_exec_${marker ?? pluginId}_`
  return extractExecTools()
    .filter(t => t.name.startsWith(prefix))
    .map(t => ({
      name: t.name,
      summary: t.description?.trim().split(/[.\n]/)[0] || t.name,
      ...(t.description ? { description: t.description } : {}),
    }))
}

function execToolNames(): Set<string> {
  return new Set(extractExecTools().map(t => t.name))
}

function pluginCliContributions(prefixes: string[], execToolSet: Set<string>): CliCommandContribution[] {
  if (!prefixes.length) return []
  const matched = CLI_COMMANDS.filter(cmd => prefixes.some(p => cmd.name === p || cmd.name.startsWith(p)))
  return matched.map(cmd => {
    // Best-effort dispatch routing: if a command's name maps to a known exec
    // tool by convention, reference it. Otherwise leave dispatch out — the
    // command stays driven by the binary's CLI dispatcher.
    const guess = `bakin_exec_${cmd.name.replace(/[-:\s]+/g, '_')}`
    const dispatch = execToolSet.has(guess)
      ? { type: 'execTool' as const, name: guess }
      : undefined
    return {
      name: cmd.name,
      usage: cmd.usage,
      summary: cmd.summary,
      ...(cmd.aliases?.length ? { aliases: [...cmd.aliases] } : {}),
      ...(dispatch ? { dispatch } : {}),
    }
  })
}

function buildContributes(plan: PluginPlan, execToolSet: Set<string>) {
  const apiRoutes = pluginRouteContributions(plan.id)
  const execTools = pluginExecToolContributions(plan.id, plan.execToolMarker)
  const cliCommands = pluginCliContributions(plan.cliPrefixes, execToolSet)
  const contributes: Record<string, unknown> = {}
  if (apiRoutes.length) contributes.apiRoutes = apiRoutes
  if (execTools.length) contributes.execTools = execTools
  if (cliCommands.length) contributes.cliCommands = cliCommands
  if (plan.settings?.length) contributes.settings = plan.settings
  contributes.docs = { slug: `using/${plan.id}` }
  return contributes
}

function applyContributes(plan: PluginPlan, execToolSet: Set<string>): { changed: boolean; counts: Record<string, number> } {
  const manifestPath = join(repoRoot, 'plugins', plan.id, 'bakin-plugin.json')
  const raw = readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as Record<string, unknown>
  const contributes = buildContributes(plan, execToolSet)
  const counts = {
    apiRoutes: (contributes.apiRoutes as unknown[] | undefined)?.length ?? 0,
    execTools: (contributes.execTools as unknown[] | undefined)?.length ?? 0,
    cliCommands: (contributes.cliCommands as unknown[] | undefined)?.length ?? 0,
  }
  manifest.contributes = contributes
  const next = JSON.stringify(manifest, null, 2) + '\n'
  if (next === raw) return { changed: false, counts }
  writeFileSync(manifestPath, next, 'utf8')
  return { changed: true, counts }
}

const execToolSet = execToolNames()
let totalChanged = 0
for (const plan of PLAN) {
  const { changed, counts } = applyContributes(plan, execToolSet)
  if (changed) totalChanged++
  console.log(`${changed ? 'updated' : 'unchanged'}  ${plan.id.padEnd(10)} routes=${counts.apiRoutes} tools=${counts.execTools} cli=${counts.cliCommands}`)
}
console.log(`\n${totalChanged} of ${PLAN.length} manifests changed.`)
