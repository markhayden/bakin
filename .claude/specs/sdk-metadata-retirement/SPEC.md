# Retire the SDK metadata entrypoint — #805

Status: approved by the user with “do it”; implementation in progress.
Issue: https://github.com/markhayden/bakin/issues/805

## Objective and decisions

Remove `@makinbakin/sdk/metadata` completely. It only forwards internal docs
contracts and helpers; no Bakin or official Bits product source consumes it.
The user confirmed there are no users to migrate, so doing this before adoption
is preferable to carrying the redundant API. No deprecation window, shim,
replacement entrypoint, or relocated public helper exports.

Keep `packages/core/src/docs` and its live internal consumers. Supported HTTP
authoring stays on `@makinbakin/sdk/routing` and the existing root exports.
The completed #804 cleanup explicitly reserved #805 for a separate PR; do not
reopen its export decisions or add unrelated cleanup.

Assumptions: no rendered behavior changes; no release, publishing, installation,
or restart of the maintainer's Bakin. Backdating applies only to new Git author
and committer dates, all September 29, 2026 in America/Denver (UTC−06:00).
Documentation and test evidence must describe the actual work honestly.

## Audited scope

| Area | Required change |
| --- | --- |
| Source SDK | Delete `packages/sdk/src/metadata/index.ts`; remove its package export, TypeScript alias, and root JSDoc listing. |
| npm build | Remove the `SDK_EXPORTS` entry, `mapSdkModule` metadata case, and release smoke import; emitted JS, declarations, and package exports must all omit the path. |
| Browser | Remove the vendor target and host import-map entry; regenerate embedded assets after a complete build so no stale `sdk-metadata.js` ships. |
| Plugin builds | Remove the entry from `SDK_EXTERNALS` and `SDK_SUBPATHS`; reject `/metadata` and `/metadata/...` before declared-dependency acceptance, including Bun's root-prefix external matching. |
| Artifact contract | Use a new family, `react19-sdk-focused-v1`, through the existing compatibility mechanism. An additive `v3` would incorrectly continue accepting the family that promised `/metadata`. No new compatibility machinery. |
| Tests | Replace fixture-only metadata imports with a supported runtime SDK API, keeping server inlining, browser externalization, and emitted declaration checks meaningful. Add absence/rejection assertions. |
| Official Bits | Remove the two stale metadata entries in `scripts/build-plugins.ts` in a small companion branch; verify against the newly built SDK. No plugin-source migration is needed. |
| Docs | Update current SDK guidance, generator, SDK README, and relevant knowledge; preserve historical evidence. |

The new family deliberately rejects previous-family artifacts through the
existing `needs-update`/install refusal paths. New artifacts carry the new
contract automatically. Older hosts must also reject new-family artifacts.
This task builds local verification artifacts only; publishing replacements
belongs to a later release. Do not rewrite installed provenance or lockfiles.

`design-system/public-api.json` and its schema cover seven visual entrypoints;
they do not contain `/metadata`. Check them, but do not invent an unrelated
schema/inventory change merely because the original issue suggested one.
The existing performance ledger may retain a removed vendor entry as an old
ceiling if its checker permits that. Record measured improvement; do not raise
budgets or regenerate unrelated baselines.

## Structure, tooling, and style

Use Bun 1.3.13, the current TypeScript toolchain, and existing build/test tools.
No dependencies or version bumps. Production changes belong in the existing
SDK/build/Whiskit modules; tests remain under `tests/{scripts,core/whiskit,ui/architecture,docs}`
and the existing consumer fixtures. Official Bits remains a separate repository.
Use named imports, single quotes, and existing TypeScript style, for example:

```ts
import { defineRoute } from '@makinbakin/sdk/routing'
```

Fixture conversion must retain an observable runtime use of the imported API.
Removing an import or replacing it with a type-only import does not prove SDK
inlining. Existing comments about the in-process builder's dependency handling
are a risk to verify, not a reason to keep the retired API or weaken coverage.
Use `/routing` in subprocess/package consumers and the public `/types` runtime
constant in in-process fixtures, whose Bun test builder cannot read Zod reliably.

## Documentation and browser evidence

Update `packages/sdk/README.md`, SDK root JSDoc,
`docs/src/content/docs/extending/sdk/overview.md`, and the SDK reference generator.
Regenerate `docs/src/content/docs/reference/generated/sdk.md` with its generator.
Check `.claude/knowledge/{repo-architecture,plugin-system,release-pipeline}.md`,
the distribution guide, and `CLAUDE.md` for affected entrypoint/contract claims.
Root README has no metadata import guidance and needs no change unless the
implementation uncovers an affected statement.

No new UI pattern, markup, styling, story, or exception is proposed. Existing
public stories and their interactions/visuals remain the unchanged contract;
full UI conformance verifies that removing a vendor entry preserves them.
Historical specs, baseline reports, and earlier audit evidence remain history.

## Success criteria and testing strategy

1. Source and built npm package cannot resolve `/metadata`; no emitted metadata
   entry JS or declaration remains. Root and `/routing` still work in an external
   consumer using the built package, without monorepo aliases.
2. The host import map, fresh vendor build, and compiled asset manifest omit the
   entry. Existing supported SDK entries still resolve and React stays shared.
3. SDK resolution accepts a complete package without metadata. Direct runtime
   imports of the retired path and nested spellings such as `/metadata/index.js`
   fail before producing an unusable plugin, including when the plugin declares
   `@makinbakin/sdk` as a dependency.
4. System-Bun and in-process builds retain server SDK inlining and client
   externalization coverage. CLI artifact assembly still succeeds locally.
5. Current-family artifacts verify; previous-family artifacts and new-family
   artifacts on old hosts are refused. Existing same-family additive semantics
   remain tested without retaining support for the previous family.
6. Official Bits builds against the candidate SDK without stale metadata maps.
7. Current docs no longer advertise `/metadata`; preserved internal docs contracts
   and unchanged visual API inventory continue to pass their checks.
8. Focused tests, full CI-equivalent tests, build, docs, and UI conformance pass;
   independent code review is completed before PR creation.

Executable commands and checkpoints are in PLAN.md. Tests use existing isolated
temporary homes and mandatory content-dir/OpenClaw mocks; they never access live
runtime data. Use `--isolate`, and `Bun.fetch` for any real local HTTP tests.

## Boundaries

- Always: remove the path across every representation together, preserve useful
  test coverage, inspect generated diffs, preserve unrelated working files.
- Revisit the plan if: a real product consumer, new public API, dependency change,
  unrelated builder redesign, visual change, or budget increase becomes necessary.
- Never: add compatibility shims, move private docs helpers into a new public
  barrel, delete core docs machinery, alter live data, publish/tag/deploy, rewrite
  existing commits, or backdate logs and verification evidence.
