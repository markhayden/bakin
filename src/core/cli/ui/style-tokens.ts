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
}

export const STATUS_TOKENS: Record<TuiStatus, TuiStatusToken> = {
  ok: { label: 'OK', color: CLI_COLORS.ok },
  warn: { label: 'WARN', color: CLI_COLORS.warn },
  fail: { label: 'FAIL', color: CLI_COLORS.fail },
  skip: { label: 'SKIP', color: CLI_COLORS.skip },
  ready: { label: 'READY', color: CLI_COLORS.info },
  run: { label: 'RUN', color: CLI_COLORS.info },
  blocked: { label: 'BLOCKED', color: CLI_COLORS.fail },
  applied: { label: 'APPLIED', color: CLI_COLORS.ok },
  sent: { label: 'SENT', color: CLI_COLORS.info },
  todo: { label: 'TODO', color: CLI_COLORS.info },
  done: { label: 'DONE', color: CLI_COLORS.ok },
}

export function statusToken(status: TuiStatus): TuiStatusToken {
  return STATUS_TOKENS[status]
}
