# Spec: Search Install Supervision Honesty (#859)

W1 of the antfly/search follow-up arc (kickoff 2026-09-19; W2–W5 = #845, #847,
#846, #849 — each gets its own spec). Priority: reduce tech debt; single-user
machine; no backwards compatibility or shims.

## Objective

`bakin install search` must never report success while the engine is not
actually running, and a correctly-configured-but-unloaded service unit must
self-heal at the next boot.

Field incident (2026-09-19, the 0.2.2 cutover): the upgrade path ran
`stopService` (launchd `bootout` — unit unloaded, plist intact) → binary swap
→ `startService` → `kickstart -k` failed ("Could not find service") → fell
back to `ensureProvisioned` → the plist byte-compare matched → returned
`'unchanged'` **without bootstrapping**. Install exited 0; search was silently
down until a human ran `launchctl bootstrap`. Deterministic, not a race: the
`unchanged` fast path conflates "plist on disk is correct" with "service is
loaded and running".

## Tech Stack

Existing: TypeScript strict, `packages/adapter-antfly/src/{service,installer}.ts`,
the `ServiceIo` seam for exec/fs fakes, bun test.

## Design (decided in kickoff interview)

Three layers, innermost first:

1. **`startService` bootstraps explicitly.** On `kickstart -k` failure, run
   `launchctl bootstrap gui/$UID <plist>` directly against the existing plist
   (then fall through to `ensureProvisioned` only if bootstrap ALSO fails —
   e.g. plist missing/invalid). systemd path: `systemctl --user start` already
   loads on demand — verify, no change expected. Layering rule: *start = make
   it run; ensure = make the config right.*

2. **`ensureProvisioned`'s `unchanged` path verifies loaded-ness.** When the
   plist byte-compares identical, additionally check the unit is loaded
   (`launchctl print gui/$UID/io.bakin.antfly` exit code; systemd:
   `systemctl --user is-active` accepting active/activating) and bootstrap/
   start when it is not. Result stays `'unchanged'` when loaded; a heal
   returns a new `'reloaded'` action (logged, so the heal is visible).
   Decision (Mark): verify EVERYWHERE — this runs at every server/CLI boot;
   +1 ~10ms subprocess per boot is accepted to make any bootout self-heal.

3. **Installer readiness gate.** After the post-swap `startService`, poll the
   engine readiness probe (existing `/readyz` helper / `GET /db/v1/tables`)
   with backoff up to a 60s budget (fresh data dir + model preload can take
   tens of seconds). On timeout: the install step returns **failed** (CLI
   exits non-zero) with a message carrying the `launchctl print` state and
   the recovery command. Applies to both the upgrade path and the
   already-installed path that (re)starts the service.

Non-goals: no durable install ledger, no doctor-check changes (the existing
`engine.supervision` check already observes launchd state on its cadence), no
retry-forever loops — one bounded gate, honest failure.

## Commands

- Test (unit): `bun test tests/adapter-antfly-service/ --isolate` (new dir if
  none exists; else colocate with existing service tests — discover in plan)
- Full suite: `bun run test`
- Lint: `bun run lint` · Typecheck: `bun run typecheck`

## Project Structure

- `packages/adapter-antfly/src/service.ts` — startService / ensureProvisioned
- `packages/adapter-antfly/src/installer.ts` — readiness gate
- Existing tests for these files (locate in plan phase) — extend, don't fork
- `.claude/knowledge/search-system.md` — update the install/supervision notes
- Ticket #859 — root-cause correction (deterministic unchanged-path hole, not
  a bootstrap race)

## Code Style

Match `service.ts` idiom: ServiceIo-injected exec, typed results, log-with-
context on failure paths, comments only for non-obvious constraints.

```ts
// start = make it run; ensure = make the config right. kickstart fails on an
// unloaded unit (the post-bootout upgrade window) — bootstrap the existing
// plist before falling back to a full re-provision.
const kick = await io.exec('launchctl', ['kickstart', '-k', target])
if (kick.code !== 0) {
  const boot = await io.exec('launchctl', ['bootstrap', `gui/${uid}`, plistPath])
  if (boot.code !== 0) await ensureProvisioned(settings, io)
}
```

## Testing Strategy

Unit tests over the `ServiceIo` fake (no real launchctl):
- startService: kickstart fails → bootstrap issued with the plist path;
  bootstrap fails → ensureProvisioned invoked.
- ensureProvisioned unchanged path: plist identical + unit NOT loaded →
  bootstrap issued, action `'reloaded'`; unit loaded → zero extra writes,
  action `'unchanged'`; systemd analog.
- Installer: readiness never comes → failed result, message names launchctl
  state; readiness on attempt N → success.
Live verification (Mark, pre-merge): bootout the unit manually, run
`bun cli/bakin.ts check`-equivalent boot, confirm self-heal; then a full
`bakin install search` re-run confirming exit 0 + engine answering.

## Boundaries

- Always: run lint + typecheck + targeted tests before commit; keep ServiceIo
  the only exec seam; keep the live 3737 server + engine untouched during dev
  (unit tests use fakes).
- Ask first: any behavior change to stopService/restartService beyond the
  three layers; touching the launchd plist template.
- Never: real launchctl calls from tests; a retry-forever install; reporting
  install success without the readiness gate passing.

## Commit Strategy (rollback checkpoints)

One branch `fix/search-install-supervision-859`, three commits, PR closes #859:
1. `fix(search): startService bootstraps the existing plist when kickstart
   finds no unit` (+ tests)
2. `fix(search): ensureProvisioned verifies the unit is loaded on the
   unchanged path` (+ tests, launchd + systemd)
3. `feat(search): installer readiness gate — install fails non-zero when the
   engine never answers` (+ tests, knowledge-doc update)
Each commit green on its own; revert granularity = one layer.

## Success Criteria

- Reproducing the field incident in tests (bootout'd unit + identical plist)
  ends with a running service and a non-'unchanged' action.
- An install whose engine never becomes ready exits non-zero and says why.
- No new subprocess calls on the loaded+unchanged hot path beyond the single
  loaded-ness probe.
- Full suite, lint, typecheck green; knowledge doc updated.

## Open Questions

None — design decisions resolved in the kickoff interview (verify-everywhere:
yes; readiness budget: 60s; failure = non-zero exit, no new doctor plumbing).
