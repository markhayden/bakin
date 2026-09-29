# Implementation plan — SDK metadata retirement

Status: approved by the user with “do it”; implementation in progress.
Spec: [SPEC.md](./SPEC.md). Branch: `chore/retire-sdk-metadata`.

## Order and checkpoints

### 1. Preserve meaningful build fixtures

Migrate the two consumer fixture server entries and the fixture strings in
`tests/core/whiskit/{build,publish-build}.test.ts` to an observable supported SDK
runtime import: `defineRoute` from `/routing` for CLI/published-package coverage,
and `HEALTH_INCIDENT_CLASSES` from `/types` for in-process build fixtures. Keep the system-Bun,
in-process, published-package, API build, and lifecycle assertions intact.
Prove the replacement builds with current code before removing the entrypoint.
If the in-process harness exposes the documented heavier-dependency problem,
diagnose and isolate that test setup rather than expanding the public API or
silencing its checks. Scope review is required for a production builder redesign.

Checkpoint A:

```sh
bun test --isolate --timeout 60000 tests/core/whiskit/build.test.ts tests/core/whiskit/publish-build.test.ts tests/api/plugins-build.test.ts tests/api/user-plugin-lifecycle.test.ts tests/scripts/build-sdk-package.test.ts
```

### 2. Add failing retirement and compatibility assertions

Extend existing tests rather than adding a parallel inventory framework:

- `tests/ui/architecture/sdk-focused-entrypoints.test.ts`: absent package export,
  alias, vendor target, import map, SDK external, resolver subpath, and source dir.
- `tests/scripts/{build-sdk-package,sdk-vendor-bundles}.test.ts`: absence in actual
  outputs, supported runtime imports preserved; use the focused consumer fixture
  for negative TypeScript resolution of the retired path.
- `tests/core/whiskit/build.test.ts`: resolve a complete SDK without metadata;
  retired runtime import is rejected with and without a declared SDK dependency;
  include one declared-SDK nested spelling (`/metadata/index.js`).
- `tests/core/whiskit/{provenance,verify}.test.ts`: new-family success, previous
  family refusal, reverse refusal, and unchanged generic additive comparison.
- `tests/docs/sdk-reference.test.ts`: no retired entry section, supported routing
  guidance still generated. Keep test doubles and expected external lists current.

Observe these assertions fail for the intended reasons before changing runtime
code. Do not commit an intentionally failing checkpoint.

### 3. Retire the contract atomically

Work in these small edit groups; they land in one retirement commit because a
partly removed public entrypoint is not a useful rollback state:

1. SDK facade/package export/root JSDoc, `tsconfig.json`, npm build target and
   the obsolete `mapSdkModule` metadata case, and the release SDK smoke import list.
2. Vendor build target, host import map, SDK external list and resolver subpaths.
3. Retired-import validation and the new artifact family in existing Whiskit code.
4. Current SDK documentation and generator; regenerate SDK reference.
5. Relevant knowledge/distribution documentation and generated embedded assets.

Use the smallest validation change that closes the retired-import escape; do not
redesign all SDK import validation. No fallback to an older installed SDK may
silently satisfy a retired import.

Build before generating the manifest so unrelated core-plugin assets are retained:

```sh
bun run build:vendors
bun run build:plugins
bun run build:host-shell
bun run build:assets-manifest
bun run scripts/docs/generate.ts
```

Checkpoint B:

```sh
bun test --isolate --timeout 60000 tests/ui/architecture/sdk-focused-entrypoints.test.ts tests/scripts/build-sdk-package.test.ts tests/scripts/sdk-vendor-bundles.test.ts tests/scripts/dev-build-one-plugin.test.ts tests/scripts/generate-embedded-assets.test.ts tests/docs/sdk-reference.test.ts tests/core/whiskit tests/api/plugins-build.test.ts tests/api/user-plugin-lifecycle.test.ts tests/architecture/release-sdk-smoke.test.ts
bun run typecheck
bun run lint
bun run docs:validate
bun run ui:public-api:check
bun run ui:conformance --quick
```

### 4. Remove the two official Bits build references

On a separate companion branch, remove only the metadata external and resolver
mapping from `bakin-bits-official/scripts/build-plugins.ts`. No plugin-source,
dependency, or SDK-stub changes are expected. Build its plugins against a local
candidate package, not the older npm fallback:

```sh
# Bakin checkout; temporary package path is disposable test output.
bun run scripts/build-sdk-package.ts --version 0.0.0-local --out /private/tmp/bakin-805-sdk
# Official Bits checkout.
BAKIN_SDK_DIR=/private/tmp/bakin-805-sdk bun run build
bun run typecheck
bun run test
```

Inspect the built clients for retired imports. The companion removal is safe to
land before Bakin: no product source imports the removed alias. Preserve the
recorded compatibility revision for Bakin's conformance evidence rather than
silently replacing it with a different sibling checkout. Do not publish artifacts.

### 5. Verify, review, and prepare PRs

```sh
bun run test:ci
bun run build
bun run ui:conformance --full
git diff --check
```

Inspect package files, browser assets, generated changes, and the final reference
search. References are allowed only in negative tests, retirement documentation,
or historical evidence. Check the visual API/schema with zero unrelated delta.
Run the existing performance check against freshly built assets; do not increase
ceilings or refresh visual baselines. Smoke-test the compiled binary with isolated
homes. Record actual evidence, including any environment limitation.

Use the code-review-and-quality skill's independent review before creating the
Bakin PR and small Bits companion PR. Address actionable findings and rerun only
the affected checks unless a new change warrants broader validation. Wait for
GitHub CI to complete; neither merge nor release is part of this task.

## Commit strategy and rollback

Set both `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` per new commit, in increasing
order on `2026-09-29` with `-06:00`. Do not amend main or prior work.

| Checkpoint | Proposed date/time | Commit purpose | Rollback |
| --- | --- | --- | --- |
| C1 | 09:15 | `docs(sdk): specify metadata entrypoint retirement` — reviewed spec/plan only. | Revert last if abandoning the whole task. |
| C2 | 10:45 | `test(sdk): exercise supported APIs in plugin build fixtures` — Checkpoint A green. | Revert only after C3, because it restores metadata imports. |
| C3 | 14:30 | `refactor(sdk)!: retire the metadata entrypoint` — complete removal, compatibility boundary, regression tests, current docs, and generated assets. | Revert this entire commit to restore the old contract coherently. |
| Bits C1 | 15:15 | `chore(build): remove retired SDK metadata mappings` — independently verified companion. | Reversible independently; coordinate if restoring the old SDK. |

Additional commits only for meaningful review fixes or final evidence; date them
later the same day before midnight. Do not manufacture commits to fill the day.
Keep issue/spec references in PR descriptions and call out the deliberate API
break and unpublished artifact-family change. A future squash/merge operation
may assign its own date; the requested dates apply to the commits we create.

## Risks already accounted for

- Fixture dependency graph: verify first, before deletion, without weakening the
  SDK inlining test or creating a replacement public helper.
- Silent stale imports: test declared dependencies and root-prefix externalization.
- Generated assets: rebuild every required input before regenerating the manifest.
- Unsupported old artifacts: existing refusal paths, explicit new family, no shim.
- Scope creep: no unrelated export cleanup, UI migration, import-framework rewrite,
  dependency upgrade, or release work.

## Planning review evidence

An isolated probe removed metadata from the in-memory external list, then checked
a fixture declaring the SDK dependency: current validation accepted the import
and a browser build retained the missing external. This confirms the early
rejection test is necessary; no repository runtime source was changed by the probe.

Independent review confirmed the new contract family and narrow scope. Its two
findings are incorporated above: remove the declaration mapper's metadata branch,
and reject nested retired paths as well as the exact entrypoint. No unresolved
scope or architecture finding remains. The user approved this proposal with “do it”.

## Implementation evidence

Checkpoint A passed: 47 tests, including CLI publishing and external package
consumption. `/routing` reproduces the documented Bun in-process test builder's
Zod `EISDIR` failure; the public, dependency-free `/types` constant preserves
observable runtime inlining there. No builder or SDK workaround was added.

Retirement assertions were observed failing before implementation. Checkpoint B
then passed 151 of 152 tests; its existing release-smoke inventory check caught
the workflow's bare `metadata` loop item. Removing that item brought its three
tests to green. Typecheck, lint (three existing warnings), docs validation,
quick UI conformance (229 architecture tests), and the browser performance
ratchet passed. The rebuilt asset manifest contains 76 entries instead of 77;
the retired vendor entry is absent (362 bytes in the recorded performance
ledger), with the remaining entries intact.

The local install was stale against the committed lockfile. `bun install
--frozen-lockfile` restored the locked dependencies without changing manifests
or the lockfile. The vendor deduplication test then passed unchanged.

Official Bits at `15508f7` passes typecheck, 677 tests (17 existing skips), and
all three plugin builds against the candidate SDK. Independent review approved
both source changes with no actionable findings and separately passed 32 tests.

Production build passed for Darwin arm64 and Linux x64/arm64; the Darwin binary
reported its version with isolated runtime homes. The first full CI-equivalent
run passed 10,478 tests with one local-environment failure: its Pi store check
found four obsolete installed package copies alongside the locked 1.0.2 copy.
Those obsolete copies were moved outside `node_modules`; the affected five tests
then passed. Full conformance's fresh repository run passed 10,479 tests with
19 existing skips. Its payload step required installing the pinned Bits
checkout's locked dependencies; remaining conformance steps resume from there.
