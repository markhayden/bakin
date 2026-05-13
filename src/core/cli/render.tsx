import { renderToString } from 'ink'
import { GenericResultView } from './ui/generic'
import { toEnvelope, type CliCommandResult, type CliEnvelope } from './result'

export type CliRenderMode = 'json' | 'plain' | 'ink'

export interface CliRenderOptions {
  mode: CliRenderMode
  color?: boolean
}

function formatDataPlain(data: unknown): string[] {
  if (data === undefined || data === null) return []
  if (typeof data === 'string') return data.length > 0 ? [data] : []
  if (typeof data === 'number' || typeof data === 'boolean') return [String(data)]
  if (Array.isArray(data)) return data.length === 0 ? [] : JSON.stringify(data, null, 2).split('\n')
  if (typeof data === 'object') {
    const keys = Object.keys(data as Record<string, unknown>)
    if (keys.length === 0) return []
    return JSON.stringify(data, null, 2).split('\n')
  }
  return [String(data)]
}

export function renderJsonEnvelope(envelope: CliEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`
}

export function renderPlainEnvelope(envelope: CliEnvelope): string {
  const lines: string[] = []
  const status = envelope.ok ? envelope.exitCode === 2 ? 'WARN' : 'OK' : 'FAIL'
  lines.push(`[${status}] ${envelope.command}`)

  if (envelope.error) {
    lines.push('')
    lines.push(envelope.error.message)
    lines.push(`Code: ${envelope.error.code}`)
  }

  const dataLines = formatDataPlain(envelope.data)
  if (dataLines.length > 0) {
    lines.push('')
    lines.push(...dataLines)
  }

  return `${lines.join('\n')}\n`
}

export function renderInkEnvelope(envelope: CliEnvelope, opts: { color?: boolean } = {}): string {
  return `${renderToString(<GenericResultView envelope={envelope} color={opts.color !== false} />)}\n`
}

export function renderCliResult(result: CliCommandResult, opts: CliRenderOptions): string {
  const envelope = toEnvelope(result)
  if (opts.mode === 'json') return renderJsonEnvelope(envelope)
  if (opts.mode === 'ink') return renderInkEnvelope(envelope, { color: opts.color })
  return renderPlainEnvelope(envelope)
}

export function resolveRenderMode(opts: {
  json?: boolean
  stdoutIsTTY?: boolean
  forceInk?: boolean
}): CliRenderMode {
  if (opts.json) return 'json'
  if (opts.forceInk) return 'ink'
  return opts.stdoutIsTTY ? 'ink' : 'plain'
}
