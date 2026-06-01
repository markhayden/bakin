# Spec: Issue 394 Version Reporting

## Objective

Fix and verify version reporting across Bakin-managed update flows.

Issue: https://github.com/markhayden/bakin/issues/394

Success means the CLI reports true before/after versions for update commands, and browser UI surfaces show the installed/current version for managed items after those updates.

Assumptions:

1. The canonical installed version for the Bakin binary is `APP_VERSION` from `packages/core/src/generated-version.ts`.
2. The canonical installed version for user plugins is `~/.bakin/plugins/lock.json.plugins[id].version`.
3. The canonical installed version for agent packages and standalone packages is `~/.bakin/packages/lock.json.packages[id].version`.
4. UI surfaces should read server/API state rather than parsing package ids such as `pixel@0.2.0`.
5. Local tests must use temp `BAKIN_HOME` and `OPENCLAW_HOME` and must not mutate real `~/.bakin` or `~/.openclaw`.

## Findings From Deep Dive

Existing behavior already covered:

- `updatePackageById()` returns `fromVersion` and `toVersion` and updates the package lockfile entry version.
- `upgradePlugin()` returns `before.version` and `after.version` and updates the plugin lockfile entry version.
- `/api/packages` exposes standalone package `version`.
- `/api/plugins/manifest` exposes plugin `version`.
- `bakin packages list` renders package versions.
- `bakin plugins list` renders plugin versions.

Likely gaps:

- `/api/agent-packages` returns raw `entry`, but the agent-package CLI table only renders agent/state/package and not the entry version.
- The Teams package card type has `entry.version`, but the package card does not display it.
- Agent package state rows used in tests often omit `entry.version`, so current UI/CLI tests would pass while hiding a missing version.
- Browser refresh after CLI-driven package updates is passive today. The package state store only refreshes on initial load and after in-UI adopt.
- Standalone non-agent package versions are currently CLI/API-only. That remains out of browser scope for this issue.
- `bakin update` reports the target release tag (`release.tag_name`) after replacement. It does not independently run the new binary. Regression coverage should verify the reported target matches the selected release asset and that `bakin version` continues to use stamped `APP_VERSION`.

## Commands

Focused verification:

```sh
bun test --isolate tests/core/self-update.test.ts
bun test --isolate tests/agent-packages/updater.test.ts tests/api/agent-packages-routes.test.ts
bun test --isolate tests/plugins/lifecycle/upgrade-smoke.test.ts
bun test --isolate tests/cli/readonly-ui.test.tsx tests/cli/readonly-commands.test.ts
bun test --isolate tests/plugins/team/use-package-states.test.ts tests/plugins/team/agent-detail-package-card.test.tsx tests/plugins/team/agent-card-package-badge.test.tsx
```

Broader checks before completion:

```sh
bun run typecheck
bun test --isolate
```

Manual local smoke, using a temp home:

```sh
BAKIN_HOME=/tmp/bakin-394 OPENCLAW_HOME=/tmp/openclaw-394 bun run server.ts --skip-onboarding-check
BAKIN_HOME=/tmp/bakin-394 OPENCLAW_HOME=/tmp/openclaw-394 bun run cli/bakin.ts agents list --packages
BAKIN_HOME=/tmp/bakin-394 OPENCLAW_HOME=/tmp/openclaw-394 bun run cli/bakin.ts packages list
BAKIN_HOME=/tmp/bakin-394 OPENCLAW_HOME=/tmp/openclaw-394 bun run cli/bakin.ts plugins list
```

## Project Structure

- `src/core/self-update.ts` - binary self-update release selection and update message.
- `src/core/cli.ts` - binary-facing `version` and `update`.
- `cli/bakin.ts` - HTTP-backed CLI commands for plugins, agents, and packages.
- `src/core/agent-packages/updater.ts` - package update result and lockfile mutation.
- `packages/host/src/api/agent-packages/list.ts` - agent package state API.
- `packages/host/src/api/packages/list.ts` - standalone package inventory API.
- `packages/host/src/api/plugins/manifest.ts` - plugin manifest API.
- `plugins/team/hooks/use-agent-store.ts` - client package-state store.
- `plugins/team/components/package-card.tsx` - Teams agent package version display.
- `plugins/health/components/health-page.tsx` - existing active plugin inventory.
- `src/core/cli/ui/readonly.tsx` - TUI tables and update result rendering.
- `.claude/knowledge/agent-packages.md`, `.claude/knowledge/plugin-system.md`, `.claude/knowledge/release-pipeline.md` - docs coverage already checked.

## Code Style

Keep changes direct and source-of-truth based:

```ts
function packageVersion(row: PackageStateRow | undefined): string {
  return row?.entry?.version ?? ''
}
```

Do not parse versions out of ids when the lockfile entry is available. Prefer adding explicit fields to API rows or rendering `entry.version` from the existing row.

## Testing Strategy

Use the prove-it pattern:

1. Add failing tests showing agent package list/card rows include the lockfile version.
2. Add update-route coverage that an update response and subsequent list response agree on the new version.
3. Add plugin Health coverage proving the Active Plugins table is backed by the installed user-plugin version when a lockfile entry exists.
4. Add self-update tests around target version messaging without downloading real assets.

Test levels:

- Unit: TUI row renderers and package-card display.
- API integration: `/api/agent-packages` and `/api/packages` from temp lockfiles.
- Lifecycle integration: agent package update and plugin upgrade lockfile before/after.
- Browser/component: Teams package card current version after store refresh.

## Boundaries

Always:

- Treat lockfiles as installed-version source of truth for managed plugins/packages.
- Keep tests isolated with temp `BAKIN_HOME` and `OPENCLAW_HOME`.
- Preserve existing JSON output shapes unless adding explicit fields is cleaner and covered.
- Keep UI dense and operational, matching existing Teams/Health style.

Out of scope for this issue:

- Adding a new browser inventory surface for standalone packages.
- Changing `bakin update` output wording from GitHub tag form (`vX.Y.Z`) to app-version form (`X.Y.Z`).
- Adding new cross-app SSE event types for package inventory refresh.

Never:

- Parse installed versions from package ids as the primary source of truth.
- Mutate real local Bakin/OpenClaw state in tests.
- Add backwards-compatibility shims for obsolete lockfile paths.

## Success Criteria

- `bakin version` reports the stamped binary version.
- `bakin update` reports the selected target release/version consistently and is covered by tests.
- `bakin agents update <id>` and `bakin agents update` render accurate `fromVersion -> toVersion`.
- `bakin agents list --packages` shows the current installed version for managed/adopted agents.
- Teams agent detail package card shows the current installed version for managed/adopted agents.
- `bakin packages update <id>` and `bakin packages list` agree on current standalone package version.
- `bakin plugins upgrade <id>` and `bakin plugins list` agree on current user plugin version.
- Browser UI shows current managed item versions on refresh after update: Health for plugins, agent detail package card for agent kits.

## Implementation Plan

### Phase 1: Regression Tests

- Add TUI tests for `AgentPackagesListReport` with `entry.version`.
- Add Team package-card tests for visible `Version`.
- Add API route tests proving list-after-update returns the new version.
- Add self-update tests for release target reporting.

### Phase 2: Agent Package Version Surface

- Normalize `/api/agent-packages` rows so managed/adopted entries expose a top-level `version` copied from `entry.version`.
- Render version in `bakin agents list --packages` plain output and TUI.
- Render version in Teams package card fields.
- Update `PackageStateRow` and related tests.

### Phase 3: Plugin And Package Inventory Confirmation

- Ensure the Health registry uses installed lockfile version for user plugins where present, falling back to active registry version for core plugins.
- Keep standalone package list on `/api/packages` and CLI as-is.
- Add Health UI version-source assertions if the plugin manifest source changes.

### Phase 4: UI Freshness

- If approved, add a package-state invalidation path for audit events `agent_pkg.updated`, `pkg.updated`, `agent_pkg.installed`, `pkg.installed`, `agent_pkg.removed`, `pkg.removed`.
- Prefer a small version bump in `useContentStore` plus `useAgentStore.refreshPackageStates()` in Teams over a broad page reload.

### Phase 5: Documentation

- Update `.claude/knowledge/agent-packages.md` CLI/UI surface notes.
- Update `.claude/knowledge/plugin-system.md` only if plugin manifest version source changes.

## Commit Strategy

1. `test(version-reporting): cover managed item versions`
   - Regression tests only. Expected to fail before implementation.
   - Verify with focused `bun test --isolate ...` commands.
2. `fix(agent-packages): expose installed versions in CLI and team UI`
   - API normalization, CLI/TUI, Teams package card.
   - Verify focused agent package and Team tests.
3. `fix(plugins): align installed plugin version display`
   - Only if deep test proves manifest/health can drift from lockfile.
   - Verify plugin lifecycle and manifest tests.
4. `fix(update): harden binary update version report`
   - Self-update reporting tests and small implementation change if needed.
   - Verify `tests/core/self-update.test.ts` and CLI version tests.
5. `docs(version-reporting): record managed version sources`
   - Knowledge/spec updates.
   - Verify docs-sensitive tests if affected.

Rollback checkpoints:

- After commit 1, no product code changed.
- After commit 2, agent package display can be reverted independently from plugin/binary work.
- After commit 3, plugin display can be reverted independently from package logic.
- After commit 4, binary update message can be reverted without touching managed item UI.

## Decision

Health's existing Active Plugins table is the plugin version surface for this issue. Agent-kit versions should appear in the individual agent detail package block next to package source, commit, and installed metadata. Standalone non-agent package versions remain CLI/API-only for now.
