export type CliExitCode = 0 | 1 | 2

export interface CliError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface CliEnvelope<TData = unknown> {
  ok: boolean
  command: string
  exitCode: CliExitCode
  data: TData
  error: CliError | null
}

export interface CliCommandResult<TData = unknown> {
  command: string
  exitCode: CliExitCode
  data: TData
  error?: CliError | null
}

export function okResult<TData>(
  command: string,
  data: TData,
  exitCode: Extract<CliExitCode, 0 | 2> = 0,
): CliCommandResult<TData> {
  return {
    command,
    exitCode,
    data,
    error: null,
  }
}

export function errorResult<TData = Record<string, never>>(
  command: string,
  code: string,
  message: string,
  opts: {
    exitCode?: Exclude<CliExitCode, 0>
    data?: TData
    details?: Record<string, unknown>
  } = {},
): CliCommandResult<TData> {
  return {
    command,
    exitCode: opts.exitCode ?? 1,
    data: opts.data ?? ({} as TData),
    error: {
      code,
      message,
      ...(opts.details ? { details: opts.details } : {}),
    },
  }
}

export function toEnvelope<TData>(result: CliCommandResult<TData>): CliEnvelope<TData> {
  return {
    ok: result.exitCode === 0 || result.exitCode === 2 && !result.error,
    command: result.command,
    exitCode: result.exitCode,
    data: result.data,
    error: result.error ?? null,
  }
}

export function serializeEnvelope(result: CliCommandResult): string {
  return `${JSON.stringify(toEnvelope(result), null, 2)}\n`
}
