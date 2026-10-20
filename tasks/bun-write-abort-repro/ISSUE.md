# Bun.write(dest, Response) ignores the fetch AbortSignal once body streaming starts

**Bun version:** 1.3.13 (macOS arm64, reproduced 2026-10-20 with the script below)

## What happens

`Bun.write(path, response)` on a `fetch` response whose body is still
streaming never settles after the request's `AbortController` fires. The
same response consumed through `response.arrayBuffer()` rejects with
`AbortError` right after the abort, as expected.

In production this hung every installer in a self-hosted app forever on a
wedged registry stream (ESTABLISHED socket, no bytes): the abort fired, the
promise never resolved or rejected, and the process sat on it indefinitely.

## Reproduction

`repro.ts` (same directory) starts a local server that trickles a body
forever, fetches it with an AbortSignal, aborts after 500 ms, and races each
consumer against a 5 s watchdog:

```
$ bun repro.ts                 # body stalls after the first chunk
[stall] response.arrayBuffer() rejected: Error after 508ms
[stall] Bun.write(dest, res)   HUNG after 5003ms
$ MODE=trickle bun repro.ts    # body keeps trickling
[trickle] response.arrayBuffer() rejected: Error after 511ms
[trickle] Bun.write(dest, res)   HUNG after 5003ms
```
(The abort reason is a plain `Error('abort after 500ms')`, hence `Error`.)

## Expected

`Bun.write(dest, response)` rejects (AbortError) once the response's
request signal aborts, like `arrayBuffer()` / `text()` do.

## Workaround

Consume the body with a manual `reader.read()` loop and enforce the
deadline around each read (that is what `packages/core/src/net/download.ts`
does in markhayden/bakin).
