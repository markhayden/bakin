import type { AdapterLogger } from '@bakin/core/adapters/shared'

/**
 * Antfly child-process log handling: parse the server's key=value log lines,
 * demote expected startup noise to debug, and surface real warnings with
 * their useful fields. Filter rules are baselined against observed server
 * output and re-checked whenever the pinned antfly version changes.
 */

type AntflyLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ParsedAntflyLogLine {
  level: AntflyLogLevel
  message: string
  data: Record<string, unknown>
}

function unquoteAntflyValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }
  return value
}

function parseAntflyFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const pattern = /([A-Za-z0-9_.-]+)=("(?:\\.|[^"])*"|[^\s]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line)) !== null) {
    fields[match[1]] = unquoteAntflyValue(match[2])
  }
  return fields
}

const SHARD_INITIALIZING_ERROR = 'shard is still initializing'
const SHARD_NOT_FOUND_ERROR_RE = /^shard ([A-Za-z0-9]+) not found$/
const STALE_SHARD_SCAN_MESSAGE = 'Failed to scan shard'
const TRANSIENT_RECONCILER_MESSAGES = new Set([
  'Failed to add index',
  'Failed to update schema',
])
const OPTIONAL_MODEL_DIRECTORY_MESSAGES = new Set([
  'Chunker models directory does not exist',
  'Generator models directory does not exist',
  'NER models directory does not exist',
  'Seq2Seq models directory does not exist',
  'Classifier models directory does not exist',
  'Reader models directory does not exist',
  'Transcriber models directory does not exist',
])
const ANTFLY_WARNING_DETAIL_KEYS = [
  'tableName',
  'table',
  'indexName',
  'name',
  'shardID',
  'error',
] as const

function compactAntflyValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function summarizeAntflyFields(fields: Record<string, string>, keys: readonly string[]): string {
  const parts: string[] = []
  for (const key of keys) {
    const value = fields[key]
    if (!value) continue
    parts.push(`${key}=${compactAntflyValue(value)}`)
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

function isTransientReconcilerWarning(message: string, fields: Record<string, string>): boolean {
  return TRANSIENT_RECONCILER_MESSAGES.has(message) && fields.error === SHARD_INITIALIZING_ERROR
}

function isStaleShardScan(message: string, fields: Record<string, string>): boolean {
  if (message !== STALE_SHARD_SCAN_MESSAGE) return false
  const shardID = fields.shardID
  const match = fields.error?.match(SHARD_NOT_FOUND_ERROR_RE)
  return typeof shardID === 'string' && match?.[1] === shardID
}

function isOptionalModelDirectoryWarning(message: string, fields: Record<string, string>): boolean {
  return OPTIONAL_MODEL_DIRECTORY_MESSAGES.has(message)
    && typeof fields.dir === 'string'
}

function isExpectedStartupDebug(message: string, fields: Record<string, string>): boolean {
  return isTransientReconcilerWarning(message, fields)
    || isStaleShardScan(message, fields)
    || isOptionalModelDirectoryWarning(message, fields)
}

function transientReconcilerMessage(message: string, fields: Record<string, string>): string {
  if (message === 'Failed to add index') {
    return `Antfly reconciler deferred index update until shard initialization completes${
      summarizeAntflyFields(fields, ['indexName', 'shardID'])
    }`
  }
  return `Antfly reconciler deferred schema update until shard initialization completes${
    summarizeAntflyFields(fields, ['shardID'])
  }`
}

function optionalModelDirectoryMessage(message: string, fields: Record<string, string>): string {
  const registry = message.replace(' models directory does not exist', '').toLowerCase()
  return `Antfly skipped optional ${registry} model registry with no local models${
    summarizeAntflyFields(fields, ['dir'])
  }`
}

function staleShardScanMessage(fields: Record<string, string>): string {
  return `Antfly skipped stale shard scan while metadata catches up${
    summarizeAntflyFields(fields, ['shardID'])
  }`
}

function formatAntflyLogMessage(
  message: string,
  level: AntflyLogLevel,
  fields: Record<string, string>,
): string {
  if (isTransientReconcilerWarning(message, fields)) {
    return transientReconcilerMessage(message, fields)
  }
  if (isStaleShardScan(message, fields)) {
    return staleShardScanMessage(fields)
  }
  if (isOptionalModelDirectoryWarning(message, fields)) {
    return optionalModelDirectoryMessage(message, fields)
  }
  if (level !== 'warn' && level !== 'error') return message
  return `${message}${summarizeAntflyFields(fields, ANTFLY_WARNING_DETAIL_KEYS)}`
}

export function parseAntflyLogLine(line: string, streamLevel: AntflyLogLevel): ParsedAntflyLogLine {
  const fields = parseAntflyFields(line)
  const parsedLevel = fields.lvl
  const rawLevel: AntflyLogLevel = parsedLevel === 'debug'
    || parsedLevel === 'info'
    || parsedLevel === 'warn'
    || parsedLevel === 'error'
    ? parsedLevel
    : streamLevel
  const rawMessage = fields.msg || line
  const level = isExpectedStartupDebug(rawMessage, fields) ? 'debug' : rawLevel

  const data: Record<string, unknown> = { source: 'antfly', raw: line }
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'ts' || key === 'lvl' || key === 'msg') continue
    data[key] = value
  }

  return {
    level,
    message: formatAntflyLogMessage(rawMessage, rawLevel, fields),
    data,
  }
}

function writeParsedAntflyLog(logger: AdapterLogger, parsed: ParsedAntflyLogLine): void {
  if (parsed.level === 'debug') logger.debug(parsed.message, parsed.data)
  else if (parsed.level === 'info') logger.info(parsed.message, parsed.data)
  else if (parsed.level === 'warn') logger.warn(parsed.message, parsed.data)
  else logger.error(parsed.message, parsed.data)
}

export function createAntflyLogBuffer(logger: AdapterLogger, streamLevel: AntflyLogLevel) {
  let pending = ''
  const flushLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    writeParsedAntflyLog(logger, parseAntflyLogLine(trimmed, streamLevel))
  }
  return {
    push(data: Buffer) {
      pending += data.toString()
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) flushLine(line)
    },
    flush() {
      flushLine(pending)
      pending = ''
    },
  }
}
