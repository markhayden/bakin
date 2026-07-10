---
title: Realtime Events
description: Push live updates from a plugin's server code to its UI with ctx.events.emit and usePluginEvent.
---

Plugins push live updates to every connected browser over Bakin's shared SSE stream. The server side emits; the client side subscribes. There is no plugin-owned socket, no polling loop, and no extra wiring — one emit call and one hook.

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

Every browser tab with Bakin open receives the event — the emitting user's tab, other tabs, other devices. The payload is delivered as-is; keep it small (ids and action verbs, not full records) and refetch through your routes for the actual data.

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

A common consumer of live events is a sidebar badge ("3 items need review"). Pair `usePluginEvent` with `useNavBadge` in an eager badge provider — see [Client UI](/docs/extending/plugins/client-ui/) for the badge contract.
