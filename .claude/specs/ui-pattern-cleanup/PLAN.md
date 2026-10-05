# Implementation plan — UI pattern cleanup

Status: independently reviewed; [SPEC.md](./SPEC.md) and this plan approved by
the maintainer on 2026-10-04. #807 merged through PR #972 on 2026-10-05;
all 17 CI checks passed. #808 is implemented and independently reviewed;
broad canonical CI verification is pending.
PR 1 / #807 branch: `refactor/ui-pattern-ownership`.
PR 2 / #808 branch: `refactor/settings-field-composition`, created from main
after PR 1 merges. There is no functional dependency between the fixes; this
order keeps the renderer import change out of the layout review.

## Preparation and reproducible inputs

1. Verify clean tracked files, the current base, pinned Bun, and the existing
   focused checks before changes. Preserve `.vitest-attachments/`.
2. Prepare disposable sibling checkouts for canonical validation: Bakin at the
   candidate commit and `bakin-bits-official` at the exact commit in
   `design-system/compatibility.json` (currently
   `6b5c1fa7740759e8bf955284eb5b06f586a9ceb0`). Do not repoint the maintainer's
   normal Bits checkout. Install frozen dependencies in these checkouts.
3. Run validation from the disposable Bakin checkout. Tailwind scans the actual
   sibling Bits path; setting `BAKIN_DOCS_EXTERNAL_SOURCES` alone does not change
   that CSS input. Where needed set it to the pinned checkout's `plugins/` path
   for census/docs scans as well. Record both refs with results.
4. Run `bun run build:css` with those pinned sibling inputs before SDK package
   tests or packaging. The SDK builder compiles fresh CSS and checks byte identity
   against `packages/sdk/styles.css`; a stale artifact would invalidate the check.
   Review and commit any necessary generated CSS delta with its production change.
5. Build a local SDK into `/private/tmp/bakin-ui-cleanup-sdk` using the command
   below, then build pinned Bits with `BAKIN_SDK_DIR` pointing to that candidate.
   This is local verification, not package publication. Recreate candidate output
   for each PR rather than accidentally testing a previous build.

```sh
bun --version
git status --short --branch
bun test --isolate tests/ui/architecture/agent-identity-patterns.test.ts tests/ui/architecture/picker-patterns.test.ts tests/ui/patterns/agent-identity-patterns.test.tsx tests/ui/patterns/picker-patterns.test.tsx
```

## PR 1 — #807: move presentation ownership

### A1. Capture the ownership and public contract

Update the existing agent and picker architecture tests to assert the intended
private owner, old-file absence, public/private runtime identity, and absence of
app/SDK back-imports. Preserve existing behavior tests. Check the existing public
export inventory and adapter boundary before moving code.

- Acceptance: new ownership assertions fail for the missing private ownership;
  current agent/picker behavior tests pass and retain meaningful coverage.
- Verification: focused checks in the preparation command; record the expected
  ownership failures without committing a red checkpoint.
- Files: `tests/ui/architecture/{agent-identity-patterns,picker-patterns}.test.ts`.

### A2. Relocate both implementations and route their consumers atomically

Perform these small edit groups, then verify the whole move:

1. Move `agent-patterns.tsx`, `picker-patterns.tsx`, and `presentation-color.ts`
   into the private UI patterns directory. Use local UI primitive/state/text
   and utility imports; the helper remains local and unexported.
2. Explicitly export existing agent/picker values and types from the private
   patterns barrel and re-export the same contracts from the SDK patterns barrel.
3. Change the settings renderer and `AssetLibraryPicker` to import private
   presentation from the UI patterns entry. Their behavior and data wiring stay
   unchanged. Update the architecture test's adapter import expectation.
4. Move the existing picker exception scope/allowance key and migration entry to
   its new file path. Preserve counts, approval metadata, and summary budgets;
   retain sorted migration entries. The conformance checks exercise this mapping.

- Acceptance: old SDK agent/picker/helper files are absent; public exports and
  types are unchanged; adapters keep their existing data ownership and callbacks.
  No temporary helper export, cross-package deep import, or shim is needed.
- Verification: focused agent/picker checks, `ui:public-api:check`, and the existing
  SDK build/vendor tests. Inspect emitted package JS and declarations.
- Files: three moved modules; UI and SDK barrels; two SDK adapter imports; the
  existing architecture tests from A1. Each edit group touches at most three
  logical modules; the complete relocation lands in one production commit.

Do not commit intentionally failing tests or duplicate implementations. A partial
relocation is not a useful rollback state, so A1/A2 share the same green commit.

### A3. Documentation and verification

Update only the affected package-ownership description and supported-import
guidance noted in SPEC.md. Reuse existing stories and their interaction coverage;
the move adds no new visual contract. Review the final import graph, SDK output,
public inventory, CSS/vendor deltas, and official-Bits consumer build.

Checkpoint A:

```sh
bun run build:css
bun test --isolate --timeout 60000 tests/ui/architecture/agent-identity-patterns.test.ts tests/ui/architecture/picker-patterns.test.ts tests/ui/patterns/agent-identity-patterns.test.tsx tests/ui/patterns/picker-patterns.test.tsx tests/ui/patterns/plugin-settings-renderer.test.tsx tests/scripts/build-sdk-package.test.ts tests/scripts/sdk-vendor-bundles.test.ts
bun run ui:public-api:check
bun run ui:conformance --quick
bun run scripts/build-sdk-package.ts --version 0.0.0-local --out /private/tmp/bakin-ui-cleanup-sdk
```

From the pinned Bits verification checkout:

```sh
BAKIN_SDK_DIR=/private/tmp/bakin-ui-cleanup-sdk bun run build
```

Complete the shared final gate below before code review and PR creation. If the
build changes payloads, attribute the delta to its import/chunk graph first.
The current ratchet ignores checkout-path comments and tolerates small build
noise; the old issue's blanket rebaseline instruction is not an acceptance rule.

Validation finding: the move exposed the navigation guard's broad private
patterns import as a payload regression. Route that one import through the
already-exported `@bakin/ui/patterns/unsaved-changes-dialog`, then rerun the
navigation/dirty-exit contracts, package/vendor tests, typecheck, and production
payload check. Keep this measured fix in a separate corrective checkpoint;
reverting the move does not require reverting the narrower dialog import.

## PR 2 — #808: compose settings list rows

### B1. Record the current behavior and strengthen useful evidence

Use the existing settings/form stories. Preserve `CanonicalUsage` as the simple
example. Extend `MessagingSchemaWorkflow` evidence or add a focused named variant
in the same existing component entry to demonstrate boolean-first/middle/last,
multiple booleans, more than three cells, wrapped/required labels, and short rows.
Keep fixtures deterministic and service-free; use existing story setup patterns.

Extend the existing settings renderer unit tests for any uncovered behavior that
the wrapper/root composition could affect. Add browser assertions for geometry,
container-based reflow, accessible names, and keyboard switch activation; class
string checks alone do not prove layout. Use a targeted source/architecture check
only to guard the original internal-slot coupling, not a snapshot of new markup.

- Acceptance: the intended current semantics are captured; the coupling guard
  fails on the old consumer selectors. Record relevant before-change visuals.
- Verification: focused renderer tests and the new story/browser assertions.
- Files: settings story, focused renderer test, existing host renderer test if its
  grid-root assumption changes, browser coverage under `tests/ui/browser/`.

### B2. Implement the existing-Field composition

Keep the responsive settings-row grid. Add owned, non-interactive compact cells;
put vertical Fields across shared label/control tracks and horizontal Fields as
whole components on the control track. Use existing `className` on owned roots
and preserve Field context; do not create new public layout props or wrappers.

Remove the descendant selectors and important overrides. Keep the changes local
to compact scalar/list-row composition. Preserve standalone fields, fieldset
validation, agent toggles, callbacks, current keys, and highlight refs. Check how
the host test locates the grid after adding neutral cells; make assertions about
layout responsibility and behavior rather than depending on incidental ancestry.

- Acceptance: all SPEC.md #808 cases pass without internal-slot selectors; no new
  public API, dependency, control style, or validation behavior is introduced.
- Verification: focused unit tests, Storybook interactions, and canonical browser
  geometry at narrow, two-column, and three-column container widths. Verify a
  narrow container in a wide viewport as well as a 320px viewport. Extend the
  existing 200% text check to assert alignment and absence of overlap in compact
  mixed rows, including enlarged wrapping labels.
- Files: renderer and the evidence files from B1. Edit test/story and production
  groups separately, but commit the production change with its regression tests.
- Contingency: if composition cannot preserve alignment, capture the specific
  mismatch and present a concrete extension proposal before implementing it.

### B3. Documentation and conformance

Document the row composition in existing Field/settings guidance and relevant
knowledge files. Root README and SDK import tables require no additional change.
Review error/disabled/busy states and label/message relationships, including
standalone Fields, rather than checking only a successful filled form.

Checkpoint B:

```sh
bun run build:css
bun test --isolate --timeout 60000 tests/ui/patterns/plugin-settings-renderer.test.tsx tests/components/plugin-settings-renderer.test.tsx tests/ui/architecture/form-composition.test.ts
bun run ui:test:stories storybook/public/forms/plugin-settings-renderer.stories.tsx storybook/public/forms/form-composition.stories.tsx
bun run ui:conformance --quick
bun run scripts/build-sdk-package.ts --version 0.0.0-local --out /private/tmp/bakin-ui-cleanup-sdk
```

The geometry test runs through `bun run ui:test:browsers` in the shared gate.
Use the canonical image for before/after evidence. Existing screenshot changes
are failures to investigate, not automatic approval to update baselines.

## Final gate for each PR

Use the pinned verification inputs above and the current candidate commit:

```sh
bun run ui:conformance --full
git diff --check
```

The full command includes architecture/type/lint checks, the repository tests,
CSS/vendor/core-plugin/host builds, payload check, deterministic public Storybook,
story interactions, canonical visuals, cross-browser tests, plugin conformance,
and docs checks. Ensure pinned Bits clients were built against the candidate SDK
before the payload step. Record pass/fail evidence per gate; do not repeat already
passing full jobs without a new change or unresolved concern. CI can supply
canonical completion evidence where the local environment cannot; record that
limitation accurately and require green applicable CI before calling the PR ready.

Use `code-review-and-quality` before opening each PR; fix actionable findings and
rerun affected checks. No merge or release is included. PR 1 references/closes
#807 only; PR 2 references/closes #808 only. Neither claims to rename table slots.

## Commit strategy and rollback

Use real timestamps, conventional scoped messages, and only meaningful green
checkpoints. Do not create extra commits to meet a date or count target.

| PR / commit | Contents and verification | Rollback |
| --- | --- | --- |
| 807 / C1 `docs(ui): specify pattern ownership and field composition cleanup` | Approved SPEC/PLAN; verify links, commands, and scope against the tree. | Documentation-only revert. |
| 807 / C2 `refactor(ui): own agent and picker presentation in the private kit` | Complete A1/A2 move, adapter/barrel updates, architecture assertions, affected ownership docs, and any necessary regenerated CSS; Checkpoint A green. | Revert the whole move commit, restoring implementations, consumers, and generated CSS together. |
| 807 / C3 `fix(ui): keep navigation on the focused dirty-exit dialog import` | Existing focused import and architecture expectation, package/navigation/type checks, measured payload correction, and verification notes. | Independently reversible; reverting it while keeping C2 reintroduces the measured payload regression. |
| 808 / C1 `refactor(forms): compose compact settings fields through owned layout cells` | B1/B2 code, regression/story/browser evidence, directly related guidance, and necessary regenerated CSS; Checkpoint B and canonical geometry green. | Revert the full composition commit and its CSS; #807 can remain merged. |
| Each / optional final evidence or review fix | Only concrete review corrections or recorded validation/status updates; affected checks green. | Revert newest corrections first, then the underlying change if abandoning it. |

Update spec/plan status with real evidence before each PR handoff. Do not cherry-pick
an implementation without its matching tests/exports. New story variants must be
reverted with the changed behavior if they depend on it.

## Planning review

- Existing APIs resolve both tasks; no new Field API is presumed necessary.
- SDK publication and vendor behavior are covered in addition to workspace tests.
- Private helper ownership, root-barrel cycles, and adapter data boundaries are explicit.
- Layout proof covers control order, wrapping, row packing, accessibility, and
  container widths; it does not expand list validation or change renderer state.
- Pinned Bits is a real sibling for CSS as well as a docs scan input.
- Documentation review includes current knowledge and READMEs; no sweeping rewrite.
- Relocation and layout have independent commits/PRs and reversible boundaries.
- No automatic inventory, performance-budget, or visual-baseline refresh.
- The maintainer approved this concrete plan; implementation follows these checkpoints.

Independent read-only review on 2026-10-04 found one required correction: rebuild
canonical CSS before SDK package checks/builds and keep that artifact in the same
rollback unit. This plan now does so. The review also recommended explicit 200%
text alignment/overlap coverage; it is included above. No remaining plan-level
architecture or scope findings were reported. This is planning evidence only,
not a claim that implementation tests or browser checks have run.

## #807 implementation evidence

- Original focused baseline: 22 passing tests. Ownership assertions first failed
  in five expected places, then passed after relocation.
- Package/component/architecture checkpoint: 37 tests pass; emitted SDK JS and
  declarations build successfully (302 files). All three pinned Bits plugins
  build against the candidate SDK.
- Quick conformance passes: 231 architecture tests, TypeScript, public API
  (7 entries / 317 values / 426 types), census, tokens, style, story, and kit gates.
- Full conformance passed lint, then 10,481 tests / 19 skips / 0 failures across
  1,091 files and all CSS/vendor/core-plugin/host builds. It exposed the navigation
  payload regression documented above. The focused-import correction passes the
  original complete payload gate (16 plugin clients, 37 vendor chunks, one CSS
  copy); navigation reachability is 166,592 bytes. No ceiling increased.
- Following that correction, SDK package/vendor tests passed; the obsolete broad
  import expectation was updated, then all 11 navigation/dirty-state tests and
  TypeScript passed. The candidate SDK and pinned Bits consumers were rebuilt.
- Canonical CSS is byte-identical. Import-cycle check reports no new cycles.
- Public Storybook builds twice with deterministic story and fixture manifests.
- Independent review covered the relocation, exact governance-path migration,
  and focused navigation import; no outstanding findings.
- Local Storybook interactions could not launch because the newly installed
  Playwright dependency has no matching Chromium binary in the local cache.
  CI subsequently passed all 17 checks on `318c8e734`, including the remaining
  story/browser/visual/conformance and docs gates (run `37253234722`). PR #972
  merged as `ddcc33441`; #807 is closed. The local full command did not pass
  end to end; canonical completion evidence comes from that CI run.


## #808 implementation evidence

- Based on merged main `ddcc33441`. Validation uses disposable Bakin/Bits
  siblings, with Bits pinned to `6b5c1fa7740759e8bf955284eb5b06f586a9ceb0`.
- Original focused baseline: 21 tests pass. The new architecture assertion
  failed on the original descendant selectors; the implementation removes them.
  All 23 focused tests then pass, including compact names, exact submitted
  values, reset, unavailable controls, existing list validation and highlighting.
- `CompactListComposition` supplies mixed controls, three booleans, required,
  wrapping and unbroken labels, and incomplete grid rows. Canonical browser
  coverage checks one/two/three columns, narrow containers in a wide viewport,
  320px viewports, 200% text, packing, control-track alignment, no overlap,
  containment, label activation and keyboard order.
- Baseline Chromium geometry passed before implementation. Candidate geometry
  passed Chromium, Firefox and WebKit. Existing desktop/mobile settings visual
  baselines pass unchanged; canonical desktop and 320px/200% captures were
  visually inspected. No snapshot, exception, API or payload ceiling changed.
- Quick checks pass: 232 architecture tests, TypeScript, tokens, public API,
  census, style/story/kit ratchets. Full local conformance passes lint,
  10,483 repository tests (19 skips, zero failures; 1,091 files), builds,
  payload limits, deterministic public Storybook and all 368 story interaction
  tests (116 files; five internal-only entries skipped). The local full run was
  stopped before broad visual execution to use the PR’s sharded canonical Linux
  jobs for the remaining visuals/browser/plugin/docs gates. Completion evidence
  belongs on the PR; the local full command did not pass end to end.
- Candidate SDK package builds (302 files); all three pinned Bits plugins build
  against it. Canonical CSS adds the two direct placement/subgrid utilities and
  removes the broad-child and important descendant overrides.
- Independent review found no production correctness or scope issues. Its one
  test synchronization concern is resolved using the existing explicit story
  completion marker before browser resizing and interaction.
- Public Field composition guidance and the style-guide knowledge entry now
  document whole-Field layout ownership. SDK/root README imports and the public
  API inventory remain accurate; no additional updates are needed there.
