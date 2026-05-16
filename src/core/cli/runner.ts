import { errorResult, type CliCommandResult } from './result'
import { parseCliInvocation, type ParsedCliInvocation } from './parser'

export type CliCommandHandler<TData = unknown> = (
  parsed: ParsedCliInvocation,
) => Promise<CliCommandResult<TData>> | CliCommandResult<TData>

export interface CliRunner {
  register(commandName: string, handler: CliCommandHandler): void
  run(argv: string[]): Promise<CliCommandResult>
}

export function createCliRunner(): CliRunner {
  const handlers = new Map<string, CliCommandHandler>()

  return {
    register(commandName, handler) {
      handlers.set(commandName, handler)
    },

    async run(argv) {
      const parsed = parseCliInvocation(argv)
      const handler = handlers.get(parsed.commandName)
      if (!handler) {
        return errorResult(
          parsed.commandName || 'unknown',
          parsed.commandFound ? 'COMMAND_NOT_IMPLEMENTED' : 'UNKNOWN_COMMAND',
          parsed.commandFound
            ? `Command "${parsed.commandName}" is not implemented in the canonical runner yet.`
            : `Unknown command: ${parsed.commandName}`,
          { details: { args: parsed.args } },
        )
      }
      return await handler(parsed)
    },
  }
}
