/**
 * Bakin dev client (v1 skeleton).
 *
 * Injected into index.html by _static.ts when BAKIN_DEV=1. Opens an
 * EventSource on /api/dev/events and logs every DevEvent it receives.
 * Commit 5 replaces the logging with actual CSS hot-swap, full-page
 * reload, and the error overlay.
 */
const es = new EventSource('/api/dev/events')

es.addEventListener('open', () => {
  console.log('[bakin-dev] connected')
})

es.addEventListener('message', (ev: MessageEvent<string>) => {
  try {
    const event = JSON.parse(ev.data)
    console.log('[bakin-dev]', event)
  } catch {
    console.log('[bakin-dev] (unparseable)', ev.data)
  }
})

es.addEventListener('error', () => {
  console.warn('[bakin-dev] EventSource error — will auto-reconnect')
})

export {}
