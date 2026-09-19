# Implementation Plan: Search Install Supervision Honesty (#859)

Spec: `.claude/specs/search-install-supervision.md` · Branch:
`fix/search-install-supervision-859` · One PR, three commits (rollback
checkpoints), live test before merge.

## Overview

Close the deterministic hole where a booted-out unit + byte-identical plist
leaves `bakin install search` reporting success with the engine down:
startService learns to bootstrap, ensureProvisioned's `unchanged` path learns
to verify loaded-ness, and the installer's upgrade/already-installed paths get
the readiness gate the reset path already has.

## Grounding facts (read during planning)

- The upgrade path (`installer.ts:365-367`) already runs `ensureProvisioned`
  → `startService`, but BOTH no-op when the plist is identical and the unit is
  unloaded; it then reports `installed` with **no readiness gate**.
- The reset path (`installer.ts:101-118`) already has the 30 s
  `isLocalServerResponding()` poll + honest `failed` result → extract and
  reuse, don't reinvent.
- `EnsureResult.action` union (`service.ts:265`); sole non-test consumer is a
  log passthrough (`adapter.ts:64`) — adding `'reloaded'` is safe.
- Existing tests: `tests/adapter-antfly/service.test.ts` (ServiceIo fake;
  the "identical second call does NOTHING" assertion must become "no writes,
  exactly one loaded-ness probe") and `tests/core/onboarding/antfly.test.ts`
  (installer with `makePin` fixtures).
- `isLocalServerResponding` is module-level fetch — thread a probe seam
  (optional param defaulting to it) rather than mocking fetch.
- Guest/child modes skip ensure entirely (`action: 'skipped'`) — the
  loaded-ness probe is mode-gated by construction.

## Architecture decisions (from spec/interview)

- start = make it run; ensure = make the config right (bootstrap lives in
  BOTH: start uses it as the kickstart fallback; ensure uses it as the
  unchanged-path heal).
- Verify-loaded EVERYWHERE (every server/CLI boot); heal surfaces as
  `action: 'reloaded'`.
- Readiness budget: 60 s upgrade path (fresh wipe + model preload), reset
  path keeps its 30 s. Failure = `status: 'failed'` → CLI exits non-zero.

## Task List

### Phase 1 — service.ts (commits 1–2)

- [ ] **T1 (S): startService bootstraps on kickstart failure**
  - `startService` launchd: `kickstart -k` fail → `bootstrap gui/$UID <plist>`
    against the existing plist; bootstrap fail → `ensureProvisioned` (config
    may be wrong/missing). systemd: confirm `systemctl --user start` loads
    on-demand; no change.
  - Acceptance: fake io with kickstart→fail records a bootstrap call with the
    plist path; bootstrap→fail falls through to provisioning.
  - Verify: `bun test tests/adapter-antfly/service.test.ts --isolate`
  - Files: `service.ts`, `tests/adapter-antfly/service.test.ts`

- [ ] **T2 (S): ensureProvisioned unchanged-path verifies loaded**
  - Launchd: on byte-identical plist, `launchctl print gui/$UID/<label>`
    (exit-code only); not loaded → bootstrap → `action: 'reloaded'` (+ info
    log). systemd: `systemctl --user is-active` accepting active/activating;
    else `start` → `'reloaded'`. Union gains `'reloaded'`.
  - Acceptance: unchanged+loaded → zero writes, exactly one probe exec,
    `'unchanged'`; unchanged+unloaded → bootstrap/start issued, `'reloaded'`;
    both supervisors covered; existing does-NOTHING test updated to
    no-writes+one-probe.
  - Verify: same suite; `bun run typecheck` (union change).
  - Files: `service.ts`, `tests/adapter-antfly/service.test.ts`

### Checkpoint 1 (commit 1 after T1, commit 2 after T2)
- [ ] service suite green, typecheck + lint clean, each commit green alone.

### Phase 2 — installer.ts (commit 3)

- [ ] **T3 (M): readiness gate on upgrade + already-installed paths**
  - Extract the reset path's poll into `waitForEngineReady(budgetMs, probe?)`;
    reset keeps 30 s behavior. Upgrade path: after `startService`, gate with
    60 s; timeout → `status: 'failed'`, message carries the supervision state
    (`launchctl print` exit summary / `systemctl is-active` output) + recovery
    command. Already-installed path (`installer.ts:196-202`) gates its restart
    the same way.
  - Acceptance: never-ready probe → `failed` naming the supervisor state;
    ready-on-Nth-poll → `installed`; reset behavior unchanged at 30 s.
  - Verify: `bun test tests/core/onboarding/antfly.test.ts --isolate`
  - Files: `installer.ts`, `tests/core/onboarding/antfly.test.ts`

- [ ] **T4 (XS): docs + ticket hygiene**
  - `.claude/knowledge/search-system.md`: install/supervision section notes
    the verify-loaded ensure, `'reloaded'` action, and readiness gate.
    Memory-file note stays accurate ("verify unit loaded" workaround becomes
    obsolete once merged — update after merge).
  - #859: comment correcting root cause (deterministic unchanged-path hole,
    not a bootstrap race).
  - Verify: docs grep; comment posted.

### Checkpoint 2 — done
- [ ] Targeted suites + `bun run lint` + `bun run typecheck` green; PR open
  referencing spec §Commit Strategy; Mark's live pass: manual
  `launchctl bootout` → next CLI boot self-heals (`'reloaded'` in log);
  re-run `bakin install search` → exit 0 with engine answering.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Loaded-ness probe misreads a starting unit as unloaded → redundant bootstrap | Low | `launchctl print` succeeds for loading units; bootstrap of a loaded unit errors benignly (already-bootstrapped) and we log, not throw |
| `'reloaded'` breaks an unseen EnsureResult consumer | Low | typecheck sweeps the union; only adapter log + tests consume |
| Probe seam threads awkwardly through installer | Low | optional param defaulting to `isLocalServerResponding`, io-seam idiom |
| 60 s gate too tight on a slow model-preload boot | Med | gate polls `/readyz` (up before preload completes on 0.2.2 — verified during cutover); if flaky in live test, budget is one constant |

## Open Questions

None.
