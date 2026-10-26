---
title: Realtime Events
description: Push live updates from a plugin's server code to its UI with ctx.events.emit and usePluginEvent, or run a bidirectional protocol over a plugin socket route.
---

Plugins push live updates to every connected browser over Bakin's shared SSE stream. The server side emits; the client side subscribes. There is no polling loop and no extra wiring — one emit call and one hook. A plugin that needs a private, bidirectional, per-connection protocol (a terminal, for example) declares a [socket route](#socket-routes) instead.

The pattern, end to end, from the reference plugin ([`examples/reference-plugin/`](https://github.com/markhayden/bakin/tree/main/examples/reference-plugin)):

```ts
// index.ts (server) — emit after every mutation
ctx.events.emit('reference-bookmarks.changed', { action: 'created', id: bookmark.id })
```

```tsx
// components/bookmarks-page.tsx (client) — refresh when the server emits
import { usePluginEvent, usePluginJsonFetch } from '@makinbakin/sdk/hooks'

const { data, refresh } = usePluginJsonFetch<BookmarkList>('reference-bookmarks', '/')
usePluginEvent('reference-bookmarks.changed', () => refresh())
```

Every browser tab with Bakin open receives the event — the emitting user's tab, other tabs, other devices. The payload is delivered as-is — with one caveat: it is spread into the SSE envelope, so the keys `event`, `type`, and `timestamp` are RESERVED (a payload `event` key would corrupt client subscription routing). Keep payloads small (ids and action verbs, not full records) and refetch through your routes for the actual data.

## Naming

Name events `{pluginId}.{event}` — the same convention as hooks. The plugin id prefix is what keeps the shared stream collision-free, and `usePluginEvent` subscribes by exact name.

## Semantics

- **Ephemeral.** Events are fan-out only: a browser that connects after an emit never sees it, and there is no replay or ordering guarantee across reconnects. Anything durable belongs in storage; the event just tells live UIs "something changed, refetch."
- **Best-effort.** Emitting when no browser is connected is a no-op. Never gate server-side correctness on an event being observed.
- **Cheap.** Emits are synchronous fan-out to connected sockets. There is no queue to back up, so emitting on every mutation is the normal pattern.

## When to use it vs polling

Use an event when a mutation on the server should be visible in an open UI without a refresh — list pages, counters, status chips. Use polling (or nothing) when staleness is fine or when the data changes on a schedule the client already knows.

If the "event" is really agent turn output (streamed text, tool activity), that is not this API — chat-style streaming rides the runtime's chunk contract and renders through `TurnOutputView`. This page is for plugin domain events.

## Nav badges

A common consumer of live events is a sidebar dot ("needs review"). Pair `usePluginEvent` with `useNavBadge` in an eager badge provider — see [Client UI](/docs/extending/plugins/client-ui/) for the badge contract.

## Recovering current state

Subscribe to `bakin.reconcile` with `usePluginEvent` to refresh a current snapshot
when the shared connection opens/reconnects or the browser resumes. The shell
keeps reconnecting through long server outages, with a 30-second maximum backoff.
Subscribe
before the initial snapshot read as well, so late-mounted plugins recover too.
Retain the last successful snapshot on errors, retry failed reads, and prevent
older requests from replacing newer state. Reconciliation updates state only;
do not replay historical toasts, sounds, or OS notifications.

File-backed consumers use `bakin.file.changed` on the same connection. Its `file`
is the relative content path and `change` is the original file event (including
unlink). Filter by your owned prefix; content is not guaranteed on deletion.
Do not open a second EventSource for file-backed navigation indicators.

## Socket routes

A socket route is a plugin-owned WebSocket served at `/api/plugins/{pluginId}{path}`. Use one only when a connection needs its own protocol: per-viewer state, binary frames, or input flowing back to the server. Domain change notifications still belong on the shared stream above.

```ts
import { definePlugin, defineSocketRoute } from '@makinbakin/sdk'

const live = defineSocketRoute({
  path: '/live',
  summary: 'Live output for one session',
  // Optional, after the host's same-origin check: return a Response to refuse.
  admit: (request) => (new URL(request.url).searchParams.get('id') ? undefined : new Response('id required', { status: 400 })),
  open: (socket, request) => {
    socket.send('hello')
    socket.onMessage((data) => { /* string = text frame, Uint8Array = binary frame */ })
    socket.onClose((code, reason) => { /* release per-connection state */ })
  },
})

export default definePlugin({ id: 'my-plugin', name: 'My plugin', version: '1.0.0', socketRoutes: [live], activate() {} })
```

User plugins declare each path in `bakin-plugin.json` under `contributes.socketRoutes` (`{ "path": "/live", "summary": "..." }`); `bakin plugins sync-manifest` keeps it current.

### What the host guarantees

**Admission**, before the WebSocket handshake completes:
- The path must name a live route on an active plugin (otherwise 404).
- The browser's `Origin` must be this server's own host (otherwise 403). This is the cross-site WebSocket guard. It is not identity: the HTTP API is unauthenticated inside your trusted network.
- Your `admit(request)` may then refuse with any `Response`. Browsers cannot set custom headers on a WebSocket, so bind a client identity through your first message or the query string.

**Lifecycle:**
- Disabling, reloading or removing the plugin closes its sockets with code 1012.
- An admission still running when that happens is refused with 503 (`Plugin restarted; reconnect`).
- Server shutdown closes sockets with 1001; after it, nothing is admitted.
- A throwing `open` closes the socket with 1011, and so does a throwing message listener.
- A throwing close listener is logged and never stops the other close listeners.

**Frames:**
- Text frames arrive as strings and binary frames as `Uint8Array`.
- An incoming frame over 1 MiB closes the connection with 1009 and is never delivered. The host enforces this cap itself because Bun's built-in server ignores `maxPayload`.
- A malformed request target is refused with 400.

### Flow control is yours

`send()` returns `false` only once the connection is closed. The host offers **no send bound or drain signal**. On Bun's built-in WebSocket implementation, `bufferedAmount` reads 0 for roughly the first 18 MiB a stalled client leaves unread. It then grows, and it stays stale even after the client catches up, so no reliable backlog can be observed.

A protocol that streams a lot of data must acknowledge at the application level: the client ACKs what it has rendered, and the server stops sending while too much is unacknowledged. That bounds the server's queue exactly.

### Testing

`@makinbakin/sdk/testing` exposes `harness.socketRoutes`, `findSocketRoute`, and `connectTestSocket(route, request?)`. These connect in-memory over the host's own socket implementation and return `{ ok: false, response }` when `admit` refuses.

The client is returned while `open` may still be pending, as on the host, so a first-message handshake works. Await `client.opened` to see `open` settle; it rejects with the error when `open` throws, and the socket is then closed with 1011.

