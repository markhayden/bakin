/**
 * Minimal reproduction: `Bun.write(dest, response)` ignores the fetch
 * AbortSignal once body streaming has started, while
 * `response.arrayBuffer()` honours it.
 *
 *   bun tasks/bun-write-abort-repro/repro.ts
 *
 * Expected (if the bug is fixed): both branches reject with AbortError
 * shortly after the abort. Observed (Bun 1.3.13, macOS arm64): the
 * arrayBuffer branch rejects within ~0.1s of the abort; the Bun.write
 * branch never settles — the watchdog below reports HUNG after 5s.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A server whose body STALLS: headers + one chunk arrive, then the socket
// stays ESTABLISHED and silent forever (the margo 2026-09-21 wedge shape).
// Set MODE=trickle to send a chunk every 100ms instead.
const mode = process.env.MODE === 'trickle' ? 'trickle' : 'stall'
const server = Bun.serve({
  port: 0,
  fetch() {
    let timer: ReturnType<typeof setInterval> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024))
        if (mode === 'trickle') timer = setInterval(() => controller.enqueue(new Uint8Array(1024)), 100)
      },
      cancel() {
        if (timer) clearInterval(timer)
      },
    })
    return new Response(stream, { headers: { 'content-type': 'application/octet-stream' } })
  },
})
const url = `http://127.0.0.1:${server.port}/slow`

async function probe(label: string, consume: (res: Response, signal: AbortSignal) => Promise<unknown>): Promise<void> {
  const controller = new AbortController()
  const started = Date.now()
  const res = await fetch(url, { signal: controller.signal })
  setTimeout(() => controller.abort(new Error('abort after 500ms')), 500)
  const watchdog = new Promise<'HUNG'>((resolve) => setTimeout(() => resolve('HUNG'), 5_000))
  const outcome = await Promise.race([
    consume(res, controller.signal).then(() => 'resolved' as const, (err: unknown) => `rejected: ${err instanceof Error ? err.name : String(err)}` as const),
    watchdog,
  ])
  console.log(`[${mode}] ${label.padEnd(22)} ${outcome} after ${Date.now() - started}ms`)
}

await probe('response.arrayBuffer()', (res) => res.arrayBuffer())
await probe('Bun.write(dest, res)', (res) => Bun.write(join(tmpdir(), `bun-write-abort-${Date.now()}.bin`), res))

server.stop(true)
process.exit(0)
