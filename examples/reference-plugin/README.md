# Bookmarks — the Bakin reference plugin

This is the canonical, copyable plugin for external Bakin builders. It is a
small real bookmarks manager that exercises the public server contracts, a
plugin-owned page, a host slot, live events, and the same UI conformance suite
used by Bakin. It imports only `@makinbakin/sdk/*`.

| Surface | Where |
|---|---|
| Declarative HTTP routes | `index.ts` |
| Exec tool for agents | `index.ts` `activate()` |
| Settings, search, health, events, and storage | `index.ts` / `store.ts` |
| Production page and `home-widget` registration | `client-registration.tsx` |
| Host-loaded browser entry | `client.tsx` |
| Canonical list, form, state, and conversation UI | `components/` |
| Plugin-owned domain CSS | `styles.css` |
| Deterministic page-and-slot browser fixture | `tests/ui.fixture.tsx` |
| Server and UI tests | `tests/` / `bakin.ui-test.ts` |

## UI contract worth copying

The page starts from the public Storybook recipes, not local styling:

- `Patterns/List and detail pages` owns page identity, list rhythm, and the
  replaceable result region.
- `Forms/Field and form composition` owns labels, descriptions, validation,
  actions, and busy state.
- `States/System feedback` distinguishes initial loading, empty, recoverable
  error, and retained mutation feedback.
- `Foundation/Collapsible`, `Foundation/Button`, `Foundation/Card`, and the
  focused `Conversation/Turn output` contract supply the remaining pieces.

The plugin imports UI from the focused `/layout`, `/patterns`, `/ui`,
`/navigation`, and `/conversation` entrypoints. Do not add new imports from
the frozen `@makinbakin/sdk/components` barrel, copy host Tailwind utilities,
or recreate a raw control that the SDK already defines.

`styles.css` contains only domain layout that the catalog does not own. Bakin
scopes those selectors to `[data-bakin-plugin="reference-bookmarks"]` while
building the plugin. The installed client does not import the canonical SDK
stylesheet because the host already supplies it; the standalone fixture
imports it exactly once.

If a real domain requirement cannot use a defined Storybook pattern, keep the
smallest accessible exception and give the maintainer a concrete,
human-readable explanation of the requirement, the pattern considered, why
it does not fit, and the intended follow-up. An unexplained visual fork is a
conformance failure, not a styling preference.

## Data contract worth copying

- One creation path serves people and agents: the POST route and exec tool
  share `createBookmark()`.
- Storage is the source of truth; search is derived and can be rebuilt.
- Manifest contributions mirror code. Run
  `bakin plugins sync-manifest . --check` in CI.
- `usePluginEvent` refreshes both the page and widget after human- or
  agent-driven changes.
- `client-registration.tsx` exports the real production registration so the
  test fixture cannot drift into a fake implementation.

## Develop and verify

```sh
bun install
bun run typecheck
bun test
bun run test:ui
```

`bun run test:ui` renders the production page and `home-widget` through
`PluginUiFixtureHost` at 1440×900 and 320×800. It checks plugin CSS scope,
canonical stylesheet identity, overflow, axe accessibility, keyboard focus,
and browser errors, then writes HTML, JSON, and screenshots under
`test-results/bakin-ui/`.

Install Chromium once on a new development machine:

```sh
bunx playwright install chromium
```

## Install into Bakin

```sh
bakin plugins install .
# or use the live development loop:
bakin plugins link .
```
