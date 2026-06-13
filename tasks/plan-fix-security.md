# Plan: fix/security — audit security findings

Spec: `SPEC.md` + `.claude/specs/audit-2026-06/REPORT.md` (triage-approved 2026-06-11).
Branch: `fix/security-audit` off `main`. One revertable commit per finding; every commit
green on `bun run test` + `bun run typecheck`. PR gate: `bun run build` + server boot smoke.
No shims; one-time data migrations are allowed (they relocate data, they don't preserve old APIs).

## Dependency graph

All six tasks are mutually independent — no ordering constraints between them. Suggested
order is smallest/least-risky first so early commits are trivially revertable. Docs are
updated in the same commit as the change they describe (SPEC §8).

```
T1 delete legacy installer ─┐
T2 avatar id validation ────┤
T3 plugin-settings id guard ┼─→ T7 PR gate (build + smoke + docs check)
T4 ledger promptHash-only ──┤
T5 antfly password→secrets ─┤
T6 remove trustExistingDist ┘
```

## Tasks

### T1 — Delete dead legacy plugin installer
`src/core/plugin-installer.ts` (shell-injection at :116, verified dead: only importer is
its own test) + `tests/core/plugin-installer.test.ts`.
- Also remove the test-fixture references if any helper imports it (audit says none).
- **Acceptance:** both files gone; repo-wide grep for `plugin-installer` returns nothing;
  suite + typecheck green.
- Commit: `chore(security): delete dead legacy plugin installer (shell-injection liability)`

### T2 — Agent avatar path traversal
`packages/host/src/api/agents/avatar.ts:12-24` joins query `id` into the fs path unchecked.
- Validate `id` against a safe-slug regex (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` — no
  separators possible → no traversal) → 400 on failure.
- New test `tests/api/agents-avatar.test.ts`: 400 on `../`-shaped ids, URL-encoded
  separators, empty id; 200 + image bytes for a valid id; 404 for missing avatar.
  Full CLAUDE.md mock discipline (both content-dir resolvers, temp dir, cleanup).
- **Prove-it:** traversal test must FAIL against current code first (TDD).
- Commit: `fix(security): validate agent id on the avatar route`

### T3 — Plugin-settings route id validation
`packages/host/src/api/plugin-settings/[pluginId].ts:17-21` uses the last path segment
unvalidated (defense-in-depth; Node URL normalization blocks traversal today).
- Reuse the existing plugin-id regex (locate the canonical `PLUGIN_ID_RE` used by the
  plugin asset routes; import, don't redeclare) → 400 in both `get` and `put`.
- Extend/add route test with invalid-id cases.
- Commit: `fix(security): validate pluginId on the plugin-settings route`

### T4 — Ledger idempotency rows: promptHash only
`plugins/images/lib/tools.ts:349,426` put `prompt: req.prompt.slice(0,500)` into the
`ExecToolResult` that `runBilledImageCall` persists via `putIdempotent` → violates the
ledger's "coordination facts only, never content" invariant.
- Persist a minimal coordination shape (assetId, version, dims, provider/model,
  promptHash, op) instead of the full result; reconstruct a valid `ExecToolResult`
  on `load` (message references promptHash + asset, never prompt text).
- The result RETURNED to the caller on first run keeps its current shape — only the
  persisted row changes.
- Tests: existing idempotency tests updated; new assertion that the persisted
  `result_json` contains no `prompt` key / no prompt substring.
- Existing prod rows containing prompts: out of scope (note in commit body); the
  invariant holds for all new writes.
- Docs: `.claude/knowledge/execution-ledger.md` idempotency section.
- Commit: `fix(images): persist coordination facts only in idempotency rows`

### T5 — Antfly basic-auth password → secret store
`packages/core/src/settings.ts:19` keeps `auth.password` in settings.json; `GET
/api/settings` (server.ts:380) returns it unredacted — contradicts the secret-store
invariant (secret-store.ts:13-17).
- Extend `packages/core/src/media/secret-store.ts` (`ProviderSecret` gains
  `password?`) or a sibling accessor — keyed under provider id `antfly`; env override
  `ANTFLY_PASSWORD` first, store second (matches existing env→store ladder).
- Settings type: `auth?: { username: string }` — password field deleted (no shim).
- Composition point (where the app builds adapter init settings from
  `settings.search`) injects the resolved password; `packages/adapter-antfly` itself
  stays unchanged (adapter boundary).
- One-time migration on settings load/boot: if legacy `auth.password` exists in
  settings.json → write to secrets.json, strip from settings.json, log once.
- Tests: migration (legacy file → relocated), resolution order (env beats store),
  GET /api/settings response contains no password after migration.
- Docs: `.claude/knowledge/search-system.md` (and settings docs if they list auth).
- Commit: `feat(core): move antfly basic-auth password into the secret store`

### T6 — Remove github `trustExistingDist`; always rebuild from validated source
Verified post-audit: Whiskit rebuilds server bundles from the compiled binary
(`buildPluginWithSystemBun`) and resolves the SDK on consumer machines
(`resolveSdkEntrypoints` ladder) — the historical reason for trusting shipped dist is gone.
- Delete the option from `BuildUserPluginOptions` and the trust branch
  (`user-plugin-builder.ts:223-235`); freshness mtime skip remains (it's a cache, and
  rebuilds only fire when sources are newer than dist).
- Call sites: `api/plugins/install.ts:718`, `upgrade.ts:705,821`,
  `user-plugin-builder.ts:317-318` — drop the argument.
- **Scope guard:** artifact installs (whiskit-published, provenance-verified) keep their
  own path — verify during build that only github/local trust is affected.
- Tests: `tests/plugins/lifecycle/install-subpath.test.ts:149` expectation changes;
  `tests/api/plugins-build.test.ts:111,126` rewritten to assert rebuild-from-source.
- Docs: `.claude/knowledge/plugin-lifecycle.md` (github install/upgrade behavior).
- Commit: `refactor(plugins): rebuild github installs from validated source, drop dist trust`

### T7 — PR gate (checkpoint)
- `bun run test` + `bun run typecheck` + `bun run lint` green.
- `bun run build` succeeds (no `git add -A` after — build stamp trap).
- Server boots (`bun run server.ts` smoke or `bun run dev` quick check).
- Doc sweep: confirm CLAUDE.md statements still true (ledger invariant wording,
  plugin install description), README untouched areas verified.
- Open PR `fix/security-audit` → main referencing REPORT.md §security; Mark reviews/merges.

## Rollback

Each commit is independent — `git revert <sha>` of any single task is clean. T5 is the
only one with a data migration; its revert leaves the password in secrets.json (harmless;
re-applying re-resolves). No commit depends on an earlier one in this branch.
