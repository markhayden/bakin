/**
 * Match a pack-authored login `expect` pattern against probe stdout — under a
 * deadline the server can enforce.
 *
 * The pattern comes from an installed manifest and runs on the server. A
 * JavaScript RegExp backtracks: `a*a*a*a*a*a*a*a*b` over ten thousand `a`s
 * stalls the event loop for longer than the machine lives, and the probe's
 * subprocess deadline is long cleared by then (PR1 Codex r4 B1). A Worker is
 * no fence either — `worker.terminate()` resolves while the regex thread keeps
 * spinning (probed on bun 1.4.3: ~100 % CPU two seconds after terminate, the
 * process never exits). So the match runs in a CHILD PROCESS we can SIGKILL:
 * the bakin binary re-entered on its hidden `__bakin-expect-match` command
 * (compiled), or this module as a script (checkout). Each side of the protocol
 * is one JSON document: `{ pattern, input, deadlineMs }` on stdin,
 * `{ matches }` on stdout.
 *
 * The child also ends ITSELF: it runs the regex on a worker thread and exits
 * the whole process at `deadlineMs` (a second after the server's own kill),
 * so a server that dies mid-check never leaves a child spinning for good.
 */
import { spawn, type ChildProcess } from 'child_process'
import { fileURLToPath } from 'url'

import { RUNNING_FROM_BINARY } from '../plugin-resources'

export const EXPECT_MATCH_COMMAND = '__bakin-expect-match'

export interface ExpectMatchRequest {
  pattern: string
  input: string
  /** The child exits on its own at this age — cover for a server that died mid-check. */
  deadlineMs: number
}

/** Exit code of a child that reached its own deadline. */
export const EXPECT_MATCH_DEADLINE_EXIT = 124

/** Every match of the pattern, each as `[whole, ...captures]` (an unmatched group is null). */
export type ExpectMatches = (string | null)[][]

export type ExpectMatchResult =
  | { ok: true; matches: ExpectMatches }
  | { ok: false; reason: 'expect-timeout' | 'expect-error'; detail: string }

/** The matcher proper — only ever called inside the child. */
export function matchExpectInProcess(pattern: string, input: string): ExpectMatches {
  return Array.from(input.matchAll(new RegExp(pattern, 'g')), (match) => Array.from(match, (group) => group ?? null))
}

/**
 * The worker the child runs the regex on. Its source is the one matcher
 * above, serialized — there is no second implementation to drift — and it
 * loads from a data: URL, so nothing has to be bundled beside the binary.
 */
function matcherWorkerUrl(): string {
  const source = `const matchExpectInProcess = ${matchExpectInProcess.toString()};
self.onmessage = (event) => {
  try { postMessage({ matches: matchExpectInProcess(event.data.pattern, event.data.input) }) }
  catch (err) { postMessage({ error: err instanceof Error ? err.message : String(err) }) }
}`
  return `data:application/javascript;base64,${Buffer.from(source).toString('base64')}`
}

/**
 * The child side: one request on stdin, one answer on stdout. Returns the
 * exit code; an unusable request or pattern is reported on stderr with exit 1.
 * At `deadlineMs` the answer is `EXPECT_MATCH_DEADLINE_EXIT` — the caller
 * must then end the PROCESS, because a regex thread cannot be stopped any
 * other way (`worker.terminate()` returns while it keeps spinning).
 */
export async function runExpectMatchChild(stdin: string, stdout: (text: string) => void, stderr: (text: string) => void): Promise<number> {
  let request: ExpectMatchRequest
  try {
    const parsed: unknown = JSON.parse(stdin)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('request is not an object')
    const { pattern, input, deadlineMs } = parsed as Record<string, unknown>
    if (typeof pattern !== 'string' || typeof input !== 'string') throw new Error('request needs string pattern and input')
    if (typeof deadlineMs !== 'number' || !(deadlineMs > 0)) throw new Error('request needs a positive deadlineMs')
    request = { pattern, input, deadlineMs }
  } catch (err) {
    stderr(`expect-match: bad request: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
  const worker = new Worker(matcherWorkerUrl())
  const answer = await new Promise<{ matches?: ExpectMatches; error?: string } | 'deadline'>((resolve) => {
    const timer = setTimeout(() => resolve('deadline'), request.deadlineMs)
    worker.onmessage = (event: MessageEvent<{ matches?: ExpectMatches; error?: string }>) => { clearTimeout(timer); resolve(event.data) }
    worker.onerror = (event: ErrorEvent) => { clearTimeout(timer); resolve({ error: event.message }) }
    worker.postMessage({ pattern: request.pattern, input: request.input })
  })
  void worker.terminate()
  if (answer === 'deadline') {
    stderr(`expect-match: the pattern did not finish within ${request.deadlineMs} ms\n`)
    return EXPECT_MATCH_DEADLINE_EXIT
  }
  if (answer.error !== undefined || answer.matches === undefined) {
    stderr(`expect-match: ${answer.error ?? 'the matcher answered nothing'}\n`)
    return 1
  }
  stdout(`${JSON.stringify({ matches: answer.matches })}\n`)
  return 0
}

/** The child's whole stdin as text (the request is one JSON document). */
export async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

/**
 * The hidden command's dispatch, shared by the binary's CLI and the compiled
 * teeth test: the child's exit code when argv names the command, else null.
 */
export async function dispatchExpectMatch(argv: readonly string[]): Promise<number | null> {
  if (!argv.includes(EXPECT_MATCH_COMMAND)) return null
  return runExpectMatchChild(await readStdinText(), (text) => process.stdout.write(text), (text) => process.stderr.write(text))
}

/** How the server re-enters itself to run one match. */
export function expectMatchArgv(): string[] {
  return RUNNING_FROM_BINARY
    ? [process.execPath, EXPECT_MATCH_COMMAND]
    : [process.execPath, fileURLToPath(import.meta.url)]
}

export interface MatchExpectOptions {
  /** The child is SIGKILLed at the deadline; the result is `expect-timeout`. */
  timeoutMs: number
  /** Test seam — the real default re-enters this process's binary or script. */
  argv?: string[]
}

/** Run one match in a killable child. Never throws: every failure is a reason. */
export function matchExpect(pattern: string, input: string, opts: MatchExpectOptions): Promise<ExpectMatchResult> {
  const argv = opts.argv ?? expectMatchArgv()
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(argv[0]!, argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
    } catch (err) {
      resolve({ ok: false, reason: 'expect-error', detail: `cannot start the matcher: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs)
    child.stdout!.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr!.on('data', (chunk: Buffer) => err.push(chunk))
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, reason: 'expect-error', detail: `cannot start the matcher: ${error.message}` })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve({ ok: false, reason: 'expect-timeout', detail: `the pattern did not finish within ${opts.timeoutMs} ms` })
        return
      }
      if (code !== 0) {
        resolve({ ok: false, reason: 'expect-error', detail: Buffer.concat(err).toString('utf-8').trim() || `matcher exited ${code}` })
        return
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(out).toString('utf-8'))
        const matches = (parsed as { matches?: unknown })?.matches
        resolve(Array.isArray(matches)
          ? { ok: true, matches: matches as ExpectMatches }
          : { ok: false, reason: 'expect-error', detail: 'matcher answered without matches' })
      } catch (error) {
        resolve({ ok: false, reason: 'expect-error', detail: `unreadable matcher answer: ${error instanceof Error ? error.message : String(error)}` })
      }
    })
    // A request the child never reads (it died first) surfaces as EPIPE here, not as a crash.
    child.stdin!.once('error', () => {})
    // The child's own deadline sits past ours: while the server lives, the kill above decides.
    child.stdin!.end(JSON.stringify({ pattern, input, deadlineMs: opts.timeoutMs + 1_000 } satisfies ExpectMatchRequest))
  })
}

if (import.meta.main) {
  const code = await runExpectMatchChild(await readStdinText(), (text) => process.stdout.write(text), (text) => process.stderr.write(text))
  process.exit(code)
}
