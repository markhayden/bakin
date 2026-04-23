/**
 * Bakin dev client (v1).
 *
 * Injected into index.html by _static.ts when BAKIN_DEV=1. Opens an
 * EventSource on /api/dev/events and dispatches incoming DevEvents:
 *
 *   dev:ready     — log once on connect
 *   dev:building  — (no-op in v1; commit sequence skipped the top-bar ribbon)
 *   dev:css       — hot-swap the <link rel="stylesheet" href="/globals.css">
 *                   with a cache-busted href, preserve JS state, no reload
 *   dev:reload    — location.reload()
 *   dev:hot-swap  — v1 fallback: location.reload() (v2 will hot-swap plugin)
 *   dev:error     — render a fixed-position overlay at the top of the viewport
 *   dev:recover   — dismiss the overlay
 */
interface DevErrorEvent {
  type: 'dev:error'
  scope: string
  message: string
  stderr?: string
}

const OVERLAY_ID = '__bakin-dev-overlay'
const STDERR_MAX = 4096

const es = new EventSource('/api/dev/events')

es.addEventListener('open', () => {
  console.log('[bakin-dev] connected')
})

es.addEventListener('error', () => {
  console.warn('[bakin-dev] EventSource error — will auto-reconnect')
})

es.addEventListener('message', (ev: MessageEvent<string>) => {
  let event: { type: string } & Record<string, unknown>
  try {
    event = JSON.parse(ev.data)
  } catch {
    return
  }

  switch (event.type) {
    case 'dev:ready':
      break
    case 'dev:building':
      break
    case 'dev:css':
      swapCss()
      break
    case 'dev:reload':
    case 'dev:hot-swap':
      location.reload()
      break
    case 'dev:error':
      renderOverlay(event as unknown as DevErrorEvent)
      break
    case 'dev:recover':
      dismissOverlay()
      break
  }
})

function swapCss(): void {
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"][href^="/globals.css"], link[rel="stylesheet"][href="/globals.css"]',
  )
  for (const oldLink of Array.from(links)) {
    const next = oldLink.cloneNode(false) as HTMLLinkElement
    next.href = `/globals.css?v=${Date.now()}`
    next.addEventListener('load', () => {
      oldLink.remove()
    }, { once: true })
    oldLink.parentNode?.insertBefore(next, oldLink.nextSibling)
  }
}

function renderOverlay(event: DevErrorEvent): void {
  dismissOverlay()
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'background:#7c1d1d',
    'color:#fff',
    'font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
    'padding:12px 16px',
    'white-space:pre',
    'overflow-y:auto',
    'max-height:50vh',
    'z-index:2147483647',
    'cursor:pointer',
    'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
  ].join(';')

  const stderr = event.stderr && event.stderr.length > STDERR_MAX
    ? event.stderr.slice(0, STDERR_MAX) + '\n... (truncated)'
    : event.stderr ?? ''
  overlay.textContent = `${event.scope} build failed\n\n${event.message}${stderr ? '\n\n' + stderr : ''}\n\n(click to dismiss)`

  overlay.addEventListener('click', dismissOverlay)
  document.body.appendChild(overlay)
}

function dismissOverlay(): void {
  const existing = document.getElementById(OVERLAY_ID)
  if (existing) existing.remove()
}

export {}
