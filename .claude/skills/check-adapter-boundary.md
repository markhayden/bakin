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

3. Scan for raw runtime config and provider setup leaks.
   ```sh
   rg -n "runtime\\.config\\.raw|config\\.raw|\\.raw<|openclaw\\.ai" src cli plugins packages/core/src packages/host/src scripts server.ts --glob '!packages/host/public/vendor/**'
   ```
   Expected production hits are `src/core/runtime-config-raw.ts` and
   `src/core/runtime-adapter-factory.ts`.

4. Scan for legacy provider/client paths.
   ```sh
   rg -n "openclaw[-](client|home|config)|@antfly[/]sdk|src[/]core[/]antfly|runtime[-]registry|flow[_]runs" src cli plugins packages/core/src packages/host/src scripts server.ts --glob '!packages/host/public/vendor/**'
   ```
   Expected production hits: none, except denylist definitions inside the
   architecture test when that test file is intentionally included in a wider
   scan.

5. Check changed tests against the mock-safety hook.
   ```sh
   for f in $(git diff --name-only -- tests); do node .claude/hooks/check-test-mocks.mjs "$f"; done
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

## Output

Report:

- commands run
- any file:line boundary hits
- whether each hit is a real violation or an allowed factory/gate location
- the patch needed to move violations back behind `AppServices`
