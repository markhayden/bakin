/**
 * Strict argument parsing for plugin-contributed CLI commands: positionals
 * bind to declared placeholders in order, flags must be declared, and values
 * are parsed by their declared type. Nothing is guessed — a string is literal.
 */
import type { CliArgContribution, CliCommandContribution } from '../../packages/sdk/src/types/manifest'

export type CliArgMatch = { ok: true; params: Record<string, unknown> } | { ok: false; error: string }

/** The literal command words of `usage` (no `bakin`, no placeholders or options). */
export function commandLiteralWords(usage: string): string[] {
  const words = usage.trim().split(/\s+/)
  const literal = words[0] === 'bakin' ? words.slice(1) : words
  const end = literal.findIndex((word) => word.startsWith('<') || word.startsWith('['))
  return end === -1 ? literal : literal.slice(0, end)
}

function parseValue(arg: CliArgContribution, raw: string, label: string): { value: unknown } | { error: string } {
  if (arg.type === 'number') {
    const value = raw.trim() === '' ? Number.NaN : Number(raw)
    return Number.isFinite(value) ? { value } : { error: `${label} must be a number` }
  }
  if (arg.type === 'boolean') {
    if (raw === 'true') return { value: true }
    if (raw === 'false') return { value: false }
    return { error: `${label} must be true or false` }
  }
  if (arg.values && !arg.values.includes(raw)) return { error: `${label} must be one of: ${arg.values.join(', ')}` }
  return { value: raw }
}

/**
 * Match `words` (the command word plus everything after it, global flags
 * already removed) against one command. `null` means a different command.
 */
export function matchCliCommand(command: CliCommandContribution, words: string[]): CliArgMatch | null {
  const literal = commandLiteralWords(command.usage)
  if (literal.some((word, index) => words[index] !== word)) return null
  const declared = command.args ?? []
  const positionals = declared.filter((arg) => arg.positional)
  const flags = new Map(declared.filter((arg) => !arg.positional).map((arg) => [arg.name, arg]))
  const params: Record<string, unknown> = {}
  let next = 0
  const rest = words.slice(literal.length)
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]
    if (!word.startsWith('--')) {
      const arg = positionals[next++]
      if (!arg) return { ok: false, error: `Unexpected argument "${word}"` }
      const parsed = parseValue(arg, word, `<${arg.name}>`)
      if ('error' in parsed) return { ok: false, error: parsed.error }
      params[arg.name] = parsed.value
      continue
    }
    const eq = word.indexOf('=')
    const name = word.slice(2, eq === -1 ? undefined : eq)
    const arg = flags.get(name)
    if (!arg) return { ok: false, error: `Unknown option --${name}` }
    let raw: string | undefined = eq === -1 ? undefined : word.slice(eq + 1)
    if (raw === undefined && arg.type === 'boolean') raw = 'true'
    if (raw === undefined) {
      const value = rest[i + 1]
      if (value === undefined || value.startsWith('--')) return { ok: false, error: `--${name} needs a value` }
      raw = value
      i++
    }
    const parsed = parseValue(arg, raw, `--${name}`)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    if (arg.type === 'string[]') {
      params[name] = [...(params[name] as string[] | undefined ?? []), parsed.value as string]
    } else if (name in params) {
      return { ok: false, error: `--${name} was given more than once` }
    } else {
      params[name] = parsed.value
    }
  }
  const missing = declared.find((arg) => arg.required && !(arg.name in params))
  if (missing) return { ok: false, error: missing.positional ? `Missing required argument <${missing.name}>` : `Missing required option --${missing.name}` }
  return { ok: true, params }
}
