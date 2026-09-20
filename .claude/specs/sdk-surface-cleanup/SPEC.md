# SDK surface cleanup — #804

Status: implemented and verified; spec and detailed plan approved by the user.
Plan: `tasks/plan.md`; checklist: `tasks/todo.md`.

## Objective and agreed decisions

Reduce unnecessary public SDK surface without changing app behavior. The user
is the maintainer of this single-installation app and its official Bits. This
is a deliberate API contraction, not a redesign or compatibility project.

- Keep `AgentDot`, `AgentStatus`, and `ColorPicker`: public Storybook examples
  establish their supported contracts, despite #804's outdated premise.
- Delete three unused hooks and remove six unnecessary public helper exports.
- Preserve helper implementations that support live components or lifecycle.
- Keep #805 (metadata entrypoint retirement) in a separate PR.
- No deprecation aliases, compatibility shims, dependency additions, or release.

Assumption: no visible change is intended, including mobile, loading, empty,
error, disabled, busy, and long-content states. An unexpected product consumer
or observable regression requires revisiting the scope, not silently migrating it.

## Exact scope

| Public entrypoint | Remove | Keep working internally |
| --- | --- | --- |
| `/hooks` | `useFormGuard` | Existing `/navigation` dirty-exit behavior |
| `/hooks` | `useFileDrop`, `UseFileDropOptions`, `UseFileDropResult` | Existing upload surfaces |
| `/hooks` | `useVerticalResize` | `useResizablePane` and `useHorizontalResize` |
| `/patterns` | `PageHeaderOverflowMenu`, `PageHeaderOverflowMenuProps` | PageHeader and WorkspacePage overflow menus via their existing props |
| `/patterns` | `ASSIGNED_AGENT_VALUE` | AgentSelect's existing assigned-option value and behavior |
| `/utils` | `pluginApiUrl` | `pluginFetch` URL construction |
| `/utils` | `copyToClipboard` | CopyButton and the underlying clipboard behavior, including plain-HTTP fallback |
| `/slots` | `getSlotEntries`, `clearSlotsOwnedBy` | Slot rendering, ownership cleanup, unregister, and hot reload |

Delete only the three unused hook implementation files. The other removals are
public-facade changes; retain their module-private/internal exports where needed.
Do not remove unrelated exports or expand cleanup to private barrels by default.
Tests may import internal helpers to test internals; actual plugin consumers must
continue using supported public imports. Do not weaken lifecycle coverage to
make public-export removal pass.

## Storybook and architecture evidence

Existing public contracts remain authoritative:

- `storybook/public/agents/agent-avatar.stories.tsx` demonstrates AgentDot.
- `storybook/public/agents/agent-status.stories.tsx` — `CanonicalUsage`.
- `storybook/public/forms/color-picker.stories.tsx` — `CanonicalUsage`.
- `storybook/public/agents/agent-select.stories.tsx` protects assigned selection.
- `storybook/public/pages/workspace-page.stories.tsx` — `ImmersiveCanvas` protects
  compact-header overflow composition.
- `storybook/public/primitives/copy-button.stories.tsx` protects clipboard UI.

Focused browser contracts: `@makinbakin/sdk/patterns` and unchanged
`@makinbakin/sdk/navigation`. Helpers are narrowed within `/hooks`, `/utils`, and
`/slots`; no package subpath is removed, including `/metadata`.

The browser public-API inventory does not cover hooks/utils/slots. Verify those
entrypoints separately in source and the built package, including declarations.
Update the browser inventory only for the approved pattern values/type removals.
Tighten kit-coverage allowances for removed exports; do not widen any ledger.

Official Bits has no identified product consumer of these exports, but its
ambient declarations and test doubles still expose PageHeaderOverflowMenu and
slot helpers. Record that fixture drift for a separate narrowly scoped Bits
follow-up; do not modify or publish the sibling repo under this Bakin-only PR.
Compatibility-pinned Bits evidence must use its recorded revision, not silently
substitute the sibling's current main.

## Project structure and documentation

- Facades: `packages/sdk/src/{hooks,patterns,utils}/index.ts`,
  `packages/sdk/src/slots/index.tsx`.
- Hook implementations: `src/hooks/use-{form-guard,file-drop,vertical-resize}.ts`.
- Preserve live modules: SDK agent-patterns, utils/plugin-fetch, slots/registry,
  register; UI page-header, workspace-page, and behaviors/clipboard.
- Tests: `tests/sdk/`, `tests/ui/architecture/`, `tests/ui/patterns/`,
  `tests/scripts/build-sdk-package.test.ts`, and clipboard/component tests.
- Governance: `design-system/public-api.json`, `design-system/kit-coverage.json`.
- Update current guidance in `.claude/knowledge/ui-patterns.md` and
  `docs/src/content/docs/extending/ui/overview.md`; check dev-loop documentation
  still describes internal slot cleanup accurately.
- Regenerate `docs/src/content/docs/reference/generated/sdk.md` through its
  generator, not hand editing. Review SDK README, root README, and SDK JSDoc for
  affected guidance; change only relevant claims. Historical specs remain history.
- Remove stale references to the deleted vertical wrapper in neighboring hook
  comments without changing their behavior.

## Code style

Use the existing Bun/TypeScript/React toolchain; no version changes. Follow
existing single quotes, extensionless imports, and named exports. For example:

```ts
// Public facade retains the supported operation.
export { pluginFetch } from './plugin-fetch'

// Internal tests can still exercise the URL builder directly.
import { pluginApiUrl } from '../../packages/sdk/src/utils/plugin-fetch'
```

## Verification commands and strategy

Commands run from the Bakin repository. Run isolated focused tests first:

```sh
bun test --isolate tests/sdk tests/lib/copy-to-clipboard.test.tsx tests/components/agent-status.test.tsx
bun test --isolate tests/ui/patterns/page-header.test.tsx tests/ui/patterns/workspace-page.test.tsx
bun test --isolate tests/ui/architecture/sdk-focused-entrypoints.test.ts tests/ui/architecture/sdk-public-api.test.ts
bun test --isolate tests/scripts/build-sdk-package.test.ts tests/scripts/sdk-vendor-bundles.test.ts tests/architecture/release-sdk-smoke.test.ts tests/docs/sdk-reference.test.ts
bun run typecheck
bun run lint
bun run ui:public-api:check
bun run ui:kit-coverage:check
bun run ui:conformance --quick
bun run scripts/docs/generate.ts
bun run docs:validate
bun run ui:conformance --full
```

Add failing regression coverage before each removal: removed public names are
absent, preserved APIs remain available, and the three hook files are gone.
Validate named exports and declarations from a self-contained built SDK, not
only workspace aliases. Use the existing package-build test harness and an
isolated temporary consumer; never install into the maintainer's live app.
Exercise preserved slot ownership/unregister, assigned selection, overflow
menus, fetch routing, clipboard fallback, and shared resize behavior.

Run relevant existing Storybook interactions and canonical browser/visual checks
as part of full conformance. Expect no visual diffs. Investigate a diff instead
of refreshing baselines. No product page is intentionally changed, so a new
plugin fixture is not required; any discovered page change requires a scope review.

## Boundaries

- Always: preserve internal behavior; maintain negative and positive API tests;
  keep docs and allowed API deltas in the same logical change; use isolated test
  data; keep the maintainer's Storybook running; inspect generated diffs.
- Ask first: additional removals, product migrations, public replacements,
  visual-baseline changes, performance ceilings, CI changes, or sibling-repo edits.
- Never: remove live helpers, reintroduce `/components`, add compatibility
  aliases, rewrite unrelated specs, alter runtime data, deploy, publish, or tag.

## Acceptance criteria

1. Exactly the nine agreed value exports and their listed orphan public types
   are removed; the three supported components and metadata subpath remain.
2. Only the three genuinely unused hook implementations are deleted. Required
   internal behavior passes its existing and strengthened regression tests.
3. Source and built-package JS/declarations agree; host/core/Bits product
   consumers have no broken imports; browser inventory and coverage checks pass.
4. Current docs no longer recommend removed public imports; legitimate internal
   helper documentation remains correct. No unrelated docs/generator churn.
5. Full conformance and relevant tests pass, with no unapproved baseline or
   budget changes. Any unavailable environment prerequisite is reported honestly.

## Planning gate and rollback requirements

Approve this spec before the detailed implementation plan. The plan must include
small test-first tasks, atomic commits with their tests/docs/API deltas, checkpoint
commands, and dependency-aware `git revert` rollback guidance. Suggested logical
checkpoints are hooks, utility/slot facades, then pattern facades; final ordering
must account for shared generated docs and package-build tests. Never use a hard
reset to discard unrelated work. Implementation requires plan approval too.

## Related work, explicitly not part of #804

- #805: retire the metadata entrypoint in a separate PR.
- #806: audit list/table surfaces across host, core plugins, and official Bits
  first; evaluate purpose, interactions, density, and mobile behavior; review
  keep/change and kit-gap findings with the user; then document the resulting
  selection guidance and migration backlog. The prior ruling is a hypothesis,
  not a constraint imposed on the audit. Reuse/update the existing census and
  consult the historical Storybook refit audit. No separate matching audit issue
  was found in either repo. GitHub ticket text has not been edited.

## Approval record

The user approved this specification with "approve" after agreeing to preserve
the three story-backed components and keep #805 separate. No scope questions
remain. The user then approved the implementation plan with "do it". Execution
and verification evidence is recorded in `tasks/todo.md`; no release or deployment
was performed.
