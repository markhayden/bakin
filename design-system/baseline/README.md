# Pre-revamp browser baseline

This directory records the browser UI immediately before the design-system
migration. It is diagnostic evidence, not the canonical visual-regression
suite introduced later in the plan. The capture intentionally uses Bakin's
existing deterministic `dev:mock` fixture and its sibling
`bakin-bits-official` checkout so it exercises the same core and Bits routes
used by current documentation.

## Reproduce

From a clean Bakin checkout with `bakin-bits-official` cloned beside it:

```sh
bun install
bun run build:host
bun run build:plugins
bun run build:assets-manifest
bun run ui:baseline:capture
bun run ui:baseline:check
bun run size:report
```

By default the capture command requires a free `http://127.0.0.1:3737` and
starts `bun run dev:mock` itself. This keeps the versioned workflow isolated
from an unknown development server. To deliberately reuse a running fixture,
opt in with `BAKIN_BASELINE_BASE_URL` or `--base-url`; the configured server
must already be healthy. Use `--output-dir` for an unversioned comparison run
without replacing `current/`.

When it starts the fixture, the runner creates a fresh temporary Bakin home,
uses child-process search mode, and removes that exact temporary directory at
shutdown. This prevents baseline runs from reading or mutating a developer's
normal Bakin or Imitation Crab data.

## Versioned evidence

- `manifest.json` defines the page archetypes, routes, readiness selectors,
  deterministic fixture clock, and desktop/mobile viewports.
- `current/report.json` records exact Bakin and Bits refs, tool environment,
  inventory counts, preliminary style-debt counts, browser asset sizes, route
  timings, console/network counts, output locations, and image hashes.
- `current/screenshots/` contains one stabilized WebP for every planned
  scenario and viewport.
- `VERIFICATION.md` records the clean-run comparison and known pre-existing
  compatibility finding.

Reports never contain user data or machine-specific absolute paths. Screenshot
hashes make accidental mutation visible. The raw style counts are a discovery
baseline only; the path-pinned CI ratchet is introduced by T4.

The manifest redacts only nondeterministic fixture data: dispatch countdowns,
live nav-badge counts, the temporary Agent workspace path, and Agent runtime
metrics. Health uses the Activity dashboard because OS-specific diagnostic
results belong to the existing Health verifier. Its recorded activity totals
remain live evidence and can vary slightly between independent fixture boots.
