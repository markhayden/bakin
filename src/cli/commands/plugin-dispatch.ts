/**
 * Plugin-contributed CLI commands — matches `bakin <cmd> ...` against the
 * cliCommands each installed plugin declares in its manifest and dispatches
 * to the exec tool or API route it names. Relocated verbatim from
 * cli/bakin.ts (B5.3 command-module split); the router's default case
 * lazy-imports dispatchPluginCliCommand.
 */
import { api, apiGet, apiPost } from '../http'
import { invocationCommand } from '../output'
import { printPluginCliCommandResult } from '../help'

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

export async function dispatchPluginCliCommand(cmd: string, args: string[]): Promise<boolean> {
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
