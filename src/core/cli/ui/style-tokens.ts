export const CLI_COLORS = {
  brand: '#ff2bd6',
  ok: 'green',
  warn: 'yellow',
  fail: 'red',
  skip: 'gray',
  info: 'cyan',
  muted: 'gray',
} as const

export type TuiStatus =
  | 'ok'
  | 'warn'
  | 'fail'
  | 'skip'
  | 'ready'
  | 'run'
  | 'blocked'
  | 'applied'
  | 'sent'
  | 'todo'
  | 'done'

export interface TuiStatusToken {
  label: string
  color: string
  foreground: string
}

export const STATUS_TOKENS: Record<TuiStatus, TuiStatusToken> = {
  ok: { label: 'OK', color: CLI_COLORS.ok, foreground: 'black' },
  warn: { label: 'WARN', color: CLI_COLORS.warn, foreground: 'black' },
  fail: { label: 'FAIL', color: CLI_COLORS.fail, foreground: 'white' },
  skip: { label: 'SKIP', color: CLI_COLORS.skip, foreground: 'white' },
  ready: { label: 'READY', color: CLI_COLORS.info, foreground: 'black' },
  run: { label: 'RUN', color: CLI_COLORS.info, foreground: 'black' },
  blocked: { label: 'BLOCKED', color: CLI_COLORS.fail, foreground: 'white' },
  applied: { label: 'APPLIED', color: CLI_COLORS.ok, foreground: 'black' },
  sent: { label: 'SENT', color: CLI_COLORS.info, foreground: 'black' },
  todo: { label: 'TODO', color: CLI_COLORS.info, foreground: 'black' },
  done: { label: 'DONE', color: CLI_COLORS.ok, foreground: 'black' },
}

export function statusToken(status: TuiStatus): TuiStatusToken {
  return STATUS_TOKENS[status]
}
