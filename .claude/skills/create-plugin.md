# Create Plugin

Create a Bakin plugin from the maintained runtime-plugin scaffold. Do not
reproduce the scaffold from memory: `src/core/plugin-scaffold.ts`,
`examples/reference-plugin/`, and the public plugin docs are the current
contract.

If the plugin has browser UI, load and follow
`.claude/skills/bakin-ui-conformance/SKILL.md` before choosing its page,
component, CSS, story, or test structure.

## Required workflow

1. Establish the plugin id, display name, purpose, server/client surfaces,
   dependencies, permissions, declared secrets, navigation icon, and optional
   navigation section. Plugin ids are kebab-case and must match the scaffold's
   validation rules.
2. Run `bakin plugins scaffold <id>` to create the canonical root layout:
   `bakin-plugin.json`, `index.ts`, optional `client.tsx`, tests, package
   metadata, and TypeScript configuration.
3. Customize the generated files. Use only public `@makinbakin/sdk` imports in
   a portable plugin. Never import Bakin `src`, `packages/host`, private
   `packages/ui`, another plugin's internals, or repository-only `@bakin/*`
   aliases.
4. Define server routes with `definePlugin()` and `defineRoute()`. Put routes,
   tools, hooks, search, health checks, skills, and workflows behind the public
   SDK contracts. Keep activation idempotent and clean up timers, sockets,
   watchers, and subscriptions in `onShutdown()`.
5. Keep manifest declarations aligned with code. Server-derived
   `contributes.apiRoutes` and `contributes.execTools` are maintained with
   `bakin plugins sync-manifest`; client `nav`, `routes`, `clientRoutes`, and
   `slots` remain explicit author-owned declarations.
6. For browser UI, register pages or slots from root `client.tsx`; there is no
   host `src/app/{id}` page. Select the closest public Storybook contract and
   compose focused SDK entrypoints under the UI conformance skill.
7. Test through `@makinbakin/sdk/testing`, including route validation, tool
   behavior, settings defaults, storage, error cases, and cleanup where
   applicable.
8. Run the checks below, then use `bakin plugins link .` for the live dev loop.

## Verification

From the plugin directory:

```sh
bun install
bun test
bun x tsc --noEmit
bakin plugins sync-manifest --check
```

For a client-bearing plugin, also run the focused checks required by
`bakin-ui-conformance`; run `bun run ui:conformance --quick` from a Bakin or
official Bits checkout that includes the plugin in the official census.

## Checklist

- [ ] The generated root layout is retained; no host page or import-map edits
- [ ] Manifest identity, compatibility floor, permissions, secrets, and dependencies are accurate
- [ ] Registered server routes and tools match the manifest
- [ ] Registered client routes, navigation, and slots match the manifest
- [ ] Portable code imports only public `@makinbakin/sdk` surfaces
- [ ] Settings use the current `fields` schema and reapply defaults when read
- [ ] Runtime resources have deterministic shutdown cleanup
- [ ] Tests exercise real SDK dispatch rather than private host helpers
- [ ] Browser UI records its closest public Storybook pattern and conformance evidence
- [ ] `bakin plugins sync-manifest --check` passes
- [ ] `bakin plugins link .` loads the plugin without manifest-drift warnings
