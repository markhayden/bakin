# Check Adapter Boundary

Use this skill when changing runtime, search, task, plugin, CLI, onboarding, or
health code. The goal is to prove provider details remain behind adapter
packages and Bakin-owned state remains in Bakin stores.

## Steps

1. Run the boundary test.
   ```sh
   bun test tests/architecture/adapter-boundary.test.ts --isolate
   ```

2. Run the home/path bypass lint.
   ```sh
   bun run lint:home-bypasses
   ```

3. Run ESLint. The repo-level config now includes adapter/provider import
   restrictions for production code; concrete adapter imports are allowed only
   in the adapter factory modules.
   ```sh
   bun run lint
   ```

4. Scan for raw runtime config and provider setup leaks.
   ```sh
   rg -n "runtime\\.config\\.raw|config\\.raw|\\.raw<|openclaw\\.ai" src cli plugins packages/core/src packages/host/src scripts server.ts --glob '!packages/host/public/vendor/**'
   ```
   Expected production hits are `src/core/runtime-config-raw.ts` and
   `src/core/runtime-adapter-factory.ts`.

5. Scan for legacy provider/client paths.
   ```sh
   rg -n "openclaw[-](client|home|config)|@antfly[/]sdk|src[/]core[/]antfly|runtime[-]registry|flow[_]runs" src cli plugins packages/core/src packages/host/src scripts server.ts --glob '!packages/host/public/vendor/**'
   ```
   Expected production hits: none, except denylist definitions inside the
   architecture test when that test file is intentionally included in a wider
   scan.

6. Check shipped workflow defaults for portable agent assignment. Every
   `agent:` value under `plugins/*/defaults/workflows/*.yaml` must be symbolic
   (`$assigned` today). Do not ship local runtime agent ids like `chef`,
   `pixel`, `rolo`, or `main-operator` in plugin defaults.
   ```sh
   rg -n '^\\s*agent:\\s*[^[:space:]$]' plugins/*/defaults/workflows
   ```
   Expected hits: none.

7. Check changed tests against the mock-safety hook.
   ```sh
   for f in $(git diff --name-only -- tests); do node .claude/hooks/check-test-mocks.mjs "$f"; done
   ```

8. Check changed production files against the edit-time adapter boundary hook.
   ```sh
   for f in $(git diff --name-only -- src plugins packages/core/src packages/host/src cli scripts server.ts); do node .claude/hooks/check-adapter-boundary.mjs "$f"; done
   ```

## Interpretation

- A plugin importing an adapter package is a boundary violation. Route it
  through `ctx.runtime`, `ctx.search`, or `ctx.tasks`.
- A core feature importing provider helpers is a boundary violation unless it is
  an adapter factory.
- A new `runtime.config.raw()` caller must go through
  `src/core/runtime-config-raw.ts` and add an allowlist entry.
- A provider URL in onboarding/user-facing docs should live in the adapter
  factory support metadata, not in feature modules.
- Plugin-shipped workflow defaults must not hardcode local runtime agent ids.
  Use `$assigned` until Bakin has a provider-neutral role/capability selector.

## Output

Report:

- commands run
- any file:line boundary hits
- whether each hit is a real violation or an allowed factory/gate location
- the patch needed to move violations back behind `AppServices`
