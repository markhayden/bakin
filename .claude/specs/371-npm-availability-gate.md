# Spec: npm availability gate before SDK smoke install

Tracking issue: [#371](https://github.com/markhayden/bakin/issues/371) — "Fix release SDK smoke race after npm publish"

## 1. Objective

The release workflow's `smoke-sdk` job runs `bun add ... "@makinbakin/sdk@${VERSION}"` immediately after the `publish` job finishes. npm registry propagation for a freshly published exact version is not always instantaneous, so the install can fail with:

```
error: No version matching "0.0.1-rc.8" found for specifier "@makinbakin/sdk" (but package exists)
```

This is a read-after-write propagation race, not a bad build — rerunning the failed job later succeeds. The objective is to make the release pipeline resilient to npm propagation delay by gating the smoke install on the exact version becoming resolvable, with a bounded wait and loud failure if it never appears.

**Target user:** the release maintainer (this machine is the only user). Success = no manual `smoke-sdk` reruns required for this race.

## 2. Decisions (resolved during interview)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where the gate lives | New standalone, unit-tested TS script `scripts/wait-for-npm-version.ts`, mirroring the `publish-sdk.ts` pattern (injectable `CommandRunner`, `parseArgs`, loud failure). The `smoke-sdk` job calls it via `bun run` before `bun add`. |
| 2 | Polling policy | Exponential backoff, **time-bounded**. Per-attempt delay `min(baseDelay * 2^n, maxDelay)`, capped at `maxDelay`; stop on success or when a total deadline (`timeout`) elapses. Defaults: `timeout` 120s, `baseDelay` 2s, `maxDelay` 30s. All configurable via flags. |
| 3 | `bun add` retry | **Gate only.** Trust that once `npm view pkg@version` resolves, a single `bun add` will succeed. No belt-and-suspenders retry on `bun add`. |
| 4 | Code sharing | **Extract** `scripts/lib/npm-registry.ts` as the single source of truth for the "version resolves vs 404 vs real error" classification and the `CommandRunner`/`CommandResult` types. Both `publish-sdk.ts` and the new gate import it. (`scripts/lib/common.ts` is exec-tool-oriented and imports `@bakin/core/plugin-types`, so it is the wrong home.) |
| 5 | Interface generality | **Generic, defaults to SDK.** `--package` defaults to `PUBLIC_SDK_PACKAGE_NAME` (`@makinbakin/sdk`); `--version` required and validated with the same `RELEASE_VERSION_RE` as `publish-sdk.ts`. Smoke step only needs to pass `--version`. |

Standing project constraints (from kickoff): reduce tech debt; no backwards-compat shims; this machine is the only user; keep it clean and clear.

## 3. Components

### 3.1 `scripts/lib/npm-registry.ts` (new shared module)

Single source of truth for npm-view classification, extracted from `publish-sdk.ts`.

```ts
export interface CommandResult { status: number | null; stdout: string; stderr: string }
export type CommandRunner = (cmd: string, args: string[], cwd: string) => CommandResult

/**
 * Classify the result of `npm view <pkg>@<version> version --json`.
 *  true  -> the exact version resolves (exit 0)
 *  false -> registry says it does not exist yet (E404 / 404 / "is not in this registry" / "No match found")
 *  null  -> ambiguous/real error (network, auth, etc.) — caller must fail loudly
 */
export function versionResolves(result: CommandResult): boolean | null

export function runCommand(cmd: string, args: string[], cwd: string): CommandResult // spawnSync wrapper
export function npmViewArgs(pkg: string, version: string): string[] // ['view', `${pkg}@${version}`, 'version', '--json']
```

- `versionResolves` is the renamed/relocated `packageAlreadyExistsResult` (same regex, same semantics).
- `runCommand` is the `spawnSync` wrapper currently private in `publish-sdk.ts`.
- `publish-sdk.ts` is refactored to import `CommandResult`, `CommandRunner`, `runCommand`, `versionResolves`, `npmViewArgs` from this module. Its public `CommandRunner` type re-export stays (the test imports it from `../../scripts/publish-sdk`) — re-export from the new module to avoid churn in the publish-sdk test, OR update the import; chosen approach: **re-export the type** from `publish-sdk.ts` so `publish-sdk.test.ts` is untouched. (No behavior change to `publish-sdk.ts`.)

### 3.2 `scripts/wait-for-npm-version.ts` (new gate script)

```ts
export interface WaitOptions {
  package: string       // default PUBLIC_SDK_PACKAGE_NAME
  version: string       // required, RELEASE_VERSION_RE
  timeoutMs: number      // default 120_000
  baseDelayMs: number    // default 2_000
  maxDelayMs: number      // default 30_000
}

export function parseArgs(argv: string[], env?: ...): WaitOptions
  // flags: --package, --version, --timeout (seconds), --base-delay (seconds), --max-delay (seconds)

export async function waitForNpmVersion(
  opts: WaitOptions,
  deps?: { runner?: CommandRunner; sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<void>   // resolves when version is visible; throws on timeout or real error
```

Behavior:
- Loop: run `npm view <pkg>@<version> version --json`, classify with `versionResolves`.
  - `true` → log success (attempt #, elapsed) and return.
  - `null` → throw immediately (real error; echo npm output). Do **not** keep polling through a genuine failure.
  - `false` → not visible yet; if the next delay would exceed the deadline, throw a clear timeout error; else log attempt + next delay, `await sleep(delay)`, continue.
- Per-attempt log line: attempt number, elapsed seconds, and the next delay (e.g. `[wait-for-npm-version] @makinbakin/sdk@X not visible yet (attempt 3, 6s elapsed); retrying in 8s`).
- Timeout error message names the package, version, elapsed time, and attempt count.
- `main()` mirrors `publish-sdk.ts`: parse argv, run, `catch` → print message + `process.exit(1)`. No GitHub-specific `::error::` annotations (consistent with `publish-sdk.ts`).
- **Testability:** `sleep` and `now` are injectable so unit tests simulate transient 404→availability and deadline exhaustion with zero real time elapsed.

### 3.3 `.github/workflows/release.yml` — `smoke-sdk` job

Insert a gate step before the existing install. The job already has Bun set up.

```yaml
- name: Wait for SDK version to be resolvable on npm
  shell: bash
  run: bun run scripts/wait-for-npm-version.ts --version "${VERSION}"

- name: Install exact SDK version and import subpaths
  shell: bash
  run: |
    set -euo pipefail
    ... (unchanged bun add + import checks)
```

(`--package` omitted — defaults to `@makinbakin/sdk`.) The repo is not checked out in `smoke-sdk` today; add a checkout step pinned to the release commit (matching other jobs: `ref: ${{ needs.gate.outputs.commit }}`) plus `bun install --frozen-lockfile` only if the script needs deps — the gate only shells out to `npm`/`bun -e`, so it needs the **repo source** but not node_modules. Add a lightweight checkout of `needs.gate.outputs.commit`; no `bun install` required. (`smoke-sdk` gains `needs: [gate, publish]` already present.)

## 4. Commands

- Run gate locally / in CI: `bun run scripts/wait-for-npm-version.ts --version <X> [--package <name>] [--timeout <s>] [--base-delay <s>] [--max-delay <s>]`
- Tests: `bun test tests/scripts/wait-for-npm-version.test.ts --isolate`
- Full suite: `bun test --isolate`
- Lint / typecheck: `bun run lint && bun run typecheck`

## 5. Testing strategy

New file `tests/scripts/wait-for-npm-version.test.ts`, following `publish-sdk.test.ts` conventions (injected `runner`, no real npm calls). Inject `sleep` (no-op) and `now` (manual clock) so no test waits in real time.

`parseArgs`:
- Resolves `--version`, defaults `--package` to `@makinbakin/sdk`, defaults timing values.
- Parses `--timeout`/`--base-delay`/`--max-delay` (seconds → ms).
- Rejects malformed version (reuses `RELEASE_VERSION_RE`) and missing flag values (`requires a value`).

`waitForNpmVersion`:
- **Transient 404 then availability** (the core acceptance criterion): runner returns E404 for the first N calls, then a resolving `"X"` JSON; assert it returns, polled the expected number of times, and slept between attempts.
- **Immediate availability:** resolves on first `npm view` with no sleep.
- **Real error fails fast:** runner returns a non-404 failure (e.g. `network failed`); assert it throws without exhausting the timeout (does not treat it as "not visible yet").
- **Deadline exhaustion:** runner always returns E404; with a manual clock advanced past `timeout`, assert it throws a bounded timeout error naming package/version and does not loop forever.
- **Backoff shape:** assert delays follow `min(base*2^n, maxDelay)` and are capped at `maxDelay`.

Existing `tests/scripts/publish-sdk.test.ts` must stay green after the helper extraction (no behavior change). If the type re-export approach is taken, that test needs no edits.

## 6. Documentation impact

- `.claude/knowledge/release-pipeline.md` — CI Sequence section: note the smoke-sdk job waits for npm visibility before install.
- `.claude/specs/release-pipeline.md` — update the smoke-jobs description to include the availability gate.
- `CHANGELOG.md` — add a bullet under `## [Unreleased]` (`### Fixed`): release SDK smoke no longer races npm propagation.
- README.md — **not impacted** (no smoke/propagation content; verified).

## 7. Boundaries

**Always:** keep the gate failure loud and bounded; preserve `publish-sdk.ts` behavior exactly during extraction; mirror existing script/test conventions; update the three docs above.

**Ask first:** any change that alters `publish-sdk.ts` *behavior* (vs. pure extraction); changing default timing values materially; touching other release jobs (`smoke-binaries`, `smoke-homebrew`, `publish`).

**Never:** add a `bun add` retry (explicitly out of scope per decision #3); fold the wait into `publish-sdk.ts` (decision #1); introduce a long-lived npm token or any new secret; add backwards-compat shims.

## 8. Acceptance criteria (from issue)

- [x] `smoke-sdk` waits for the exact SDK version to be resolvable before `bun add`.
- [x] The wait is bounded and emits useful attempt/timing logs.
- [x] A script test covers transient npm 404 followed by availability.
- [x] No future rerun needed for this specific race.

## 9. Commit strategy

Natural checkpoints for rollback (filled in detail during `/agent-skills:plan`):

1. `refactor(scripts): extract shared npm-registry helper from publish-sdk` — pure extraction; `publish-sdk.test.ts` stays green. Safe standalone checkpoint.
2. `feat(scripts): add bounded npm version availability gate` — new `wait-for-npm-version.ts` + its test.
3. `ci(release): gate smoke-sdk on npm version visibility` — wire the step (+ checkout) into `release.yml`.
4. `docs: record npm availability gate in release pipeline + changelog` — knowledge/spec/CHANGELOG updates.

Each commit builds, lints, typechecks, and passes tests independently.
