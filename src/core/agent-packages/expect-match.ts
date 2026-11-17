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
 * is one JSON document: `{ pattern, input, deadlineMs }` on stdin, the
 * bounded `{ matched, captures }` summary on stdout.
 *
 * The child also ends ITSELF: it runs the regex on a worker thread and exits
 * the whole process at `deadlineMs` (a second after the server's own kill),
 * so a server that dies mid-check never leaves a child spinning for good.
 */
import { spawn, type ChildProcess } from 'child_process'
import { fileURLToPath } from 'url'

import { RUNNING_FROM_BINARY } from '../plugin-resources'

export const EXPECT_MATCH_COMMAND = '__bakin-expect-match'
/** Exit code of a child that reached its own deadline. */
export const EXPECT_MATCH_DEADLINE_EXIT = 124
/** Distinct captured accounts the answer carries at most — a login listing never has this many. */
export const EXPECT_MATCH_CAPTURE_LIMIT = 256
/**
 * The most the server reads back from the child; anything longer is not an
 * answer. A complete answer is at most the capture limit × the 16 KB a probe
 * can print (every capture is a substring of it) plus JSON overhead.
 */
export const EXPECT_MATCH_ANSWER_CAP_BYTES = 8 * 1024 * 1024

export interface ExpectMatchRequest {
  pattern: string
  input: string
  /** The child exits on its own at this age — cover for a server that died mid-check. */
  deadlineMs: number
  /** The configured account, when there is one: membership is decided over EVERY match, never the capped list. */
  wanted?: string
}

/**
 * What the server needs from a match, and nothing that can grow with the
 * pattern: a 16 KB input under `(?=(a*))` yields ~128 MB of whole matches
 * (Codex r5 B3), while the distinct first captures of it fit in a line.
 */
export interface ExpectSummary {
  /** How many times the pattern matched. */
  matched: number
  /** Distinct, non-empty first-group captures in match order — the accounts shown — capped at `EXPECT_MATCH_CAPTURE_LIMIT`. */
  captures: string[]
  /** Whether some match captured exactly the requested `wanted` account — across all matches, past the cap (Codex r6 B5). */
  wantedFound: boolean
}

export type ExpectMatchResult =
  | { ok: true; summary: ExpectSummary }
  | { ok: false; reason: 'expect-timeout' | 'expect-error'; detail: string }

/** The matcher proper — only ever run on the child's worker thread (and serialized into it below). */
export function summarizeExpect(pattern: string, input: string, captureLimit: number, wanted?: string): ExpectSummary {
  let matched = 0
  let wantedFound = false
  const captures: string[] = []
  for (const match of input.matchAll(new RegExp(pattern, 'g'))) {
    matched += 1
    const account = match[1]
    if (typeof account !== 'string' || account.length === 0) continue
    if (account === wanted) wantedFound = true
    if (!captures.includes(account) && captures.length < captureLimit) captures.push(account)
  }
  return { matched, captures, wantedFound }
}

/**
 * The worker the child runs the regex on. Its source is the one matcher
 * above, serialized — there is no second implementation to drift — and it
 * loads from a data: URL, so nothing has to be bundled beside the binary.
 */
function matcherWorkerUrl(): string {
  const source = `const summarizeExpect = ${summarizeExpect.toString()};
self.onmessage = (event) => {
  try { postMessage({ summary: summarizeExpect(event.data.pattern, event.data.input, ${EXPECT_MATCH_CAPTURE_LIMIT}, event.data.wanted) }) }
  catch (err) { postMessage({ error: err instanceof Error ? err.message : String(err) }) }
}`
  return `data:application/javascript;base64,${Buffer.from(source).toString('base64')}`
}

/** A writer the child must await: `process.stdout.write` only queues, and the process exits right after (Codex r5 B3). */
export type ChildWriter = (text: string) => Promise<void>

function flushing(stream: NodeJS.WriteStream): ChildWriter {
  return (text) => new Promise((resolve, reject) => {
    stream.write(text, (err) => (err ? reject(err) : resolve()))
  })
}

/**
 * The child side: one request on stdin, one answer on stdout. Returns the
 * exit code; an unusable request or pattern is reported on stderr with exit 1.
 * At `deadlineMs` the answer is `EXPECT_MATCH_DEADLINE_EXIT` — the caller
 * must then end the PROCESS, because a regex thread cannot be stopped any
 * other way (`worker.terminate()` returns while it keeps spinning).
 */
export async function runExpectMatchChild(stdin: string, stdout: ChildWriter, stderr: ChildWriter): Promise<number> {
  let request: ExpectMatchRequest
  try {
    const parsed: unknown = JSON.parse(stdin)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('request is not an object')
    const { pattern, input, deadlineMs, wanted } = parsed as Record<string, unknown>
    if (typeof pattern !== 'string' || typeof input !== 'string') throw new Error('request needs string pattern and input')
    if (typeof deadlineMs !== 'number' || !(deadlineMs > 0)) throw new Error('request needs a positive deadlineMs')
    if (wanted !== undefined && typeof wanted !== 'string') throw new Error('wanted must be a string when present')
    request = { pattern, input, deadlineMs, ...(wanted !== undefined ? { wanted } : {}) }
  } catch (err) {
    await stderr(`expect-match: bad request: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
  const worker = new Worker(matcherWorkerUrl())
  const answer = await new Promise<{ summary?: ExpectSummary; error?: string } | 'deadline'>((resolve) => {
    const timer = setTimeout(() => resolve('deadline'), request.deadlineMs)
    worker.onmessage = (event: MessageEvent<{ summary?: ExpectSummary; error?: string }>) => { clearTimeout(timer); resolve(event.data) }
    worker.onerror = (event: ErrorEvent) => { clearTimeout(timer); resolve({ error: event.message }) }
    worker.postMessage({ pattern: request.pattern, input: request.input, wanted: request.wanted })
  })
  void worker.terminate()
  if (answer === 'deadline') {
    await stderr(`expect-match: the pattern did not finish within ${request.deadlineMs} ms\n`)
    return EXPECT_MATCH_DEADLINE_EXIT
  }
  if (answer.error !== undefined || answer.summary === undefined) {
    await stderr(`expect-match: ${answer.error ?? 'the matcher answered nothing'}\n`)
    return 1
  }
  await stdout(`${JSON.stringify(answer.summary)}\n`)
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
  return runExpectMatchChild(await readStdinText(), flushing(process.stdout), flushing(process.stderr))
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
  /** The configured account; the answer says whether some match captured exactly it. */
  wanted?: string
  /** Test seam — the real default re-enters this process's binary or script. */
  argv?: string[]
}

function summaryOf(text: string): ExpectSummary | null {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null) return null
  const { matched, captures, wantedFound } = parsed as Record<string, unknown>
  if (typeof matched !== 'number' || typeof wantedFound !== 'boolean') return null
  if (!Array.isArray(captures) || !captures.every((c) => typeof c === 'string')) return null
  return { matched, captures: captures as string[], wantedFound }
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
    let outBytes = 0
    let timedOut = false
    let overflowed = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs)
    child.stdout!.on('data', (chunk: Buffer) => {
      outBytes += chunk.byteLength
      if (outBytes > EXPECT_MATCH_ANSWER_CAP_BYTES) {
        // Not an answer any more: stop reading and stop the child.
        overflowed = true
        child.kill('SIGKILL')
        return
      }
      out.push(chunk)
    })
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
      if (overflowed) {
        resolve({ ok: false, reason: 'expect-error', detail: `the matcher answered more than ${EXPECT_MATCH_ANSWER_CAP_BYTES} bytes` })
        return
      }
      if (code !== 0) {
        resolve({ ok: false, reason: 'expect-error', detail: Buffer.concat(err).toString('utf-8').trim() || `matcher exited ${code}` })
        return
      }
      try {
        const summary = summaryOf(Buffer.concat(out).toString('utf-8'))
        resolve(summary
          ? { ok: true, summary }
          : { ok: false, reason: 'expect-error', detail: 'the matcher answered without a summary' })
      } catch (error) {
        resolve({ ok: false, reason: 'expect-error', detail: `unreadable matcher answer: ${error instanceof Error ? error.message : String(error)}` })
      }
    })
    // A request the child never reads (it died first) surfaces as EPIPE here, not as a crash.
    child.stdin!.once('error', () => {})
    // The child's own deadline sits past ours: while the server lives, the kill above decides.
    child.stdin!.end(JSON.stringify({ pattern, input, deadlineMs: opts.timeoutMs + 1_000, ...(opts.wanted !== undefined ? { wanted: opts.wanted } : {}) } satisfies ExpectMatchRequest))
  })
}

// The checkout's child entry. No top-level await: this module also sits in
// server.ts's import graph, and `bun build --compile` refuses one there.
if (import.meta.main) {
  void readStdinText()
    .then((stdin) => runExpectMatchChild(stdin, flushing(process.stdout), flushing(process.stderr)))
    .then((code) => process.exit(code))
}
