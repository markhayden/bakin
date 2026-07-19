# Bookmarks — the Bakin reference plugin

The canonical, copyable template for Bakin plugin authors. A small but real
bookmarks manager that exercises **every** plugin surface with the smallest
honest example of each — written entirely against `@makinbakin/sdk/*`, which
is the whole public authoring API.

| Surface | Where |
|---|---|
| Declarative HTTP routes (zod params/query/body) | `index.ts` `routes` |
| Exec tool for agents (`bakin_exec_<id>_*`) | `index.ts` `activate()` |
| Settings schema + `ctx.getSettings()` | `index.ts` (`maxBookmarks`, `defaultTag`) |
| Search content type + reindex + ⌘K hit renderer | `index.ts` / `client.tsx` |
| Health check (`bakin doctor`, health dashboard) | `index.ts` `activate()` |
| SSE events (`ctx.events.emit` ↔ `usePluginEvent`) | `index.ts` / `components/bookmarks-page.tsx` |
| Plugin-scoped storage (`readJson`/`writeJson`) | `store.ts` |
| Nav item + client route/page | `client.tsx` |
| `pluginFetch` / `usePluginJsonFetch` | `components/bookmarks-page.tsx` |
| `TurnOutputView` (canonical agent-turn renderer) | `components/bookmarks-page.tsx` |
| Tests via `@makinbakin/sdk/testing` | `tests/bookmarks.test.ts` |

## Patterns worth copying

- **One creation path for humans and agents** — the POST route and the exec
  tool share `createBookmark()`, so limits, defaults, indexing, and change
  events can never drift between the two surfaces. The shared function takes
  a narrow structural interface (`BookmarkServices`) that both
  `PluginContext` and `PluginToolContext` satisfy — no casts.
- **Declare-twice, generated** — every route/tool in code is mirrored in
  `bakin-plugin.json` `contributes` (what users consent to at install).
  Don't hand-maintain it: `bakin plugins sync-manifest .` regenerates the
  server-derived sections; `--check` fails CI on drift.
- **Storage is the source of truth, search is derived** — mutations write
  storage first, then fire-and-forget `search.index()`/`remove()`; the
  `reindex` generator can always rebuild the table from storage.
- **Set a real `bakin` floor** — this template uses a low floor; set yours to
  the Bakin version you actually develop against.

## Develop

```sh
bun install         # SDK + react types (for typechecking + tests)
bun test            # tests/ via @makinbakin/sdk/testing
bun x tsc --noEmit
```

The Bakin host supplies the design-system stylesheet, so do not import it from
`client.tsx`. If you mount this plugin in a standalone Storybook, browser
preview, or test harness, load the same public artifact once at that harness's
root:

```ts
import '@makinbakin/sdk/styles.css'
```

## Install into Bakin

```sh
bakin plugins install .    # copy-install; server builds dist/
bakin plugins link .       # or: live dev loop against a running server
```
