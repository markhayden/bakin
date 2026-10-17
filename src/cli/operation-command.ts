/**
 * The CLI side of a converted route (#895): start it, follow the operation to
 * its terminal outcome, and hand back the body the route used to answer (the
 * operation's `result`). Ctrl-C cancels in every mode (`followAndRender`).
 *
 * Output streams keep their old contracts:
 * - `--json`: stdout stays ONE document (the command prints the body);
 *   progress is silent and Ctrl-C notes go to stderr;
 * - piped (no TTY): stdout still carries the body the command prints, while
 *   plain progress lines go to stderr;
 * - TTY: live progress on stdout, then the command's own result card.
 */
import type { OperationStartResponse } from '@makinbakin/sdk/types'
import { jsonObject, type OperationFollowResult } from './http'
import { createOperationRenderer, describeResult, followAndRender, operationExitCode, silentOperationRenderer } from './operation-renderer'

export interface CommandOperationResult {
  follow: OperationFollowResult
  /** The route's body, when the operation finished with one. */
  body: Record<string, unknown> | null
  /** The HTTP status the route would have answered (from the operation result). */
  httpStatus: number | null
  /** 0 succeeded, 130 cancelled or detached, 1 otherwise. */
  exitCode: 0 | 1 | 130
}

export async function startAndFollow(
  start: () => Promise<unknown>,
  opts: { json: boolean; stdout?: { isTTY?: boolean } },
): Promise<CommandOperationResult> {
  const started = jsonObject(await start()) as Partial<OperationStartResponse> | null
  if (typeof started?.operationId !== 'string' || typeof started.bootId !== 'string') {
    throw new Error('The server did not start an operation — is this CLI newer than the running server? Restart Bakin and try again.')
  }
  const tty = (opts.stdout ?? process.stdout).isTTY === true
  const renderer = opts.json
    ? silentOperationRenderer()
    : tty
      ? undefined
      : createOperationRenderer({ mode: 'plain', write: (text) => { process.stderr.write(text) } })
  const follow = await followAndRender(
    { operationId: started.operationId, bootId: started.bootId },
    renderer ? { renderer } : {},
  )
  const result = follow.operation?.result
  return {
    follow,
    body: jsonObject(result?.body),
    httpStatus: result?.httpStatus ?? null,
    exitCode: operationExitCode(follow),
  }
}

/** The body the route used to answer, or an honest stand-in when the operation ended without one. */
export function operationBody(operation: CommandOperationResult): Record<string, unknown> {
  return operation.body ?? { ok: false, error: describeResult(operation.follow) }
}

/** A failed, cancelled or detached operation exits non-zero — its outcome line was already printed. */
export function exitOnFailure(operation: CommandOperationResult): void {
  if (operation.exitCode !== 0) process.exit(operation.exitCode)
}
