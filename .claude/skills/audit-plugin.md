# Audit Plugin

Audit a Bakin plugin against the current runtime-loader, manifest, public SDK,
and design-system contracts. Use `[PASS]`, `[FAIL]`, or `[SKIP]` for every
applicable item and cite concrete file paths for failures.

For any client-bearing plugin, first load and follow
`.claude/skills/bakin-ui-conformance/SKILL.md`. Its Storybook comparison,
deviation protocol, and verification requirements govern the UI portion.

## Audit checklist

### 1. Package boundary

- [ ] Root layout follows the scaffold/reference plugin conventions
- [ ] Portable plugins import only public `@makinbakin/sdk` surfaces
- [ ] No host, private UI, another plugin's internals, or repository aliases leak across the boundary
- [ ] Runtime versions and dependencies in `package.json` are deliberate

### 2. Manifest and registration

- [ ] `bakin-plugin.json` has valid identity, compatibility, permissions, dependencies, and secrets
- [ ] Every registered API route and exec tool is declared in `contributes`
- [ ] Client navigation, routes, clientRoutes, slots, and eager loading match `registerPlugin()` behavior
- [ ] `bakin plugins sync-manifest --check` passes

### 3. Server contracts

- [ ] Routes use `defineRoute()` and Zod boundary schemas where input exists
- [ ] Errors use meaningful HTTP statuses and actionable response bodies
- [ ] Exec tool names use `bakin_exec_{pluginId}_{action}` and return honest structured results
- [ ] Cross-plugin behavior uses hooks rather than direct imports
- [ ] Storage, secrets, events, search, and runtime APIs match declared permissions

### 4. Lifecycle and settings

- [ ] `activate()` is idempotent and does not hide unmanaged long-running work
- [ ] Timers, sockets, watchers, and subscriptions are released in `onShutdown()`
- [ ] Runtime setting changes use `onSettingsChange()` when restart-free behavior is expected
- [ ] `settingsSchema.fields` includes labels, descriptions, types, defaults, and validation as applicable
- [ ] Reads from `ctx.getSettings()` reapply defaults because unsaved defaults are not persisted values
- [ ] Secret values never enter settings, manifests, logs, fixtures, or lockfiles

### 5. Client and design-system conformance

- [ ] Each page/archetype names its closest public Storybook story
- [ ] UI uses focused `@makinbakin/sdk/*` entrypoints; no new frozen `/components` consumer
- [ ] Loading, empty/no-results, error, busy, disabled, success, narrow, and long-content states are covered
- [ ] Page/layout/form/feedback patterns are composed before domain CSS
- [ ] Domain CSS is narrow, responsive, and plugin-root scoped
- [ ] Only explicitly approved temporary deviations appear in `design-system/exceptions.json`
- [ ] Accessibility, keyboard, responsive, interaction, and browser checks pass

### 6. Routing

- [ ] Client pages are registered by root `client.tsx` through routes or host-owned slots
- [ ] Manifest route declarations exactly mirror runtime registration
- [ ] The routing taxonomy is preserved: path = page identity; query = overlays, tabs, filters, and view state
- [ ] Internal navigation uses the existing SPA routing contract and retains real-link semantics
- [ ] Query-state hooks preserve history, batching, string values, and scroll behavior

### 7. Observability and tests

- [ ] Significant operations emit the appropriate events, activity, or audit evidence without leaking secrets
- [ ] Tests use `@makinbakin/sdk/testing` for real route/tool dispatch and isolated storage
- [ ] Happy paths, validation failures, permission/error cases, settings, and cleanup are covered as applicable
- [ ] Browser UI passes the conformance skill's quick/full verification level for its change stage

## Output

Report:

1. findings ordered by severity, with file paths and evidence;
2. a `[PASS]` / `[FAIL]` / `[SKIP]` checklist;
3. design-system pattern and deviation evidence for browser UI;
4. exact commands run and results; and
5. any public SDK or Storybook gap that needs explicit user approval before a fix.
