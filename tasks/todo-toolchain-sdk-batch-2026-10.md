# TODO — Toolchain & SDK-Boundary Batch (2026-10-21)

Spec `.claude/specs/toolchain-and-sdk-boundary-batch-2026-10.md` · Plan `.claude/specs/toolchain-and-sdk-boundary-batch-2026-10-plan.md`. Tick a task only when its acceptance criteria and verify step both passed. PR rows close when squash-merged.

## Gate (every PR)
- [ ] slice commits gated (`typecheck && lint` + slice tests `--isolate`, each on its exit code)
- [ ] per-PR gate (`check:cycles`, `lint:home-bypasses`, `test`, `build:host && ui:conformance --quick|--full`, `docs:check`; `ui:performance`/`ui:public-api:check` without regeneration in PRs 2–4; manifest per D0.9)
- [ ] Codex ≥2 rounds (cap ~5, stop at approve), findings fixed in-batch
- [ ] CI green → squash-merge → issue closed with evidence

## PR 1 — #965 `chore/965-bun-1.4.3`
- [x] diagnostic matrix on the unchanged tree (2026-10-21: no SIGSEGV on shard 2 ×4 + Linux amd64; four deltas diagnosed)
- [x] 1.1 readiness + Ctrl-C tests poll what they assert
- [x] 1.2 fake-timer shim drains with setImmediate; `tests/setup-fake-timers.test.ts`
- [x] 1.3 downloadToFile awaits the sink's close before cleanup
- [x] 1.3b NodeConfigDrawer map_workflow cases stub + await the options load (fifth delta, amd64)
- [ ] acceptance matrix on the fixes commit (legs 1–6, completeness on full + shard union, all green)
- [ ] 1.4 `tasks/evidence-bun-1.4.3.md`
- [ ] 1.5 pin commit (.bun-version, @types/bun ~1.4.3, lock, MANAGED_BUN_VERSION + sha256s, bun-pin arch test, bunfig comment, Dockerfile/compose/lifecycle/docker:up BUN_VERSION, ratchet + manifest regenerated)
- [ ] 1.6 docs (CLAUDE.md, test-suite-health §5 + :184, release.yml comment, dependency-sweeps §3/§5, CONTRIBUTING, README, SPEC.md)
- [x] PR 1 merged (#1020); system bun 1.4.3; Bits #122 merged; #965 closed — Mark restarts 3737

## PR 2 — #890 `fix/890-antfly-commit`
- [x] 2.1 op.signal into all four probes + two cancellation cases
- [x] 2.2 refuse `share.previous`; share aside → in; `commitFileAtomic`; rollback boundary = successful binary commit
- [x] 2.3 `installerFs` seam on the installer's options; seven failure cases (+ restore-failure, pinned-path refusal) + supervisor-start failure; module-specific arch pin
- [x] 2.4 docs (close #890 at merge)
- [x] PR 2 merged (#1021, 2026-10-22); #890 closed

## PR 3 — #809a `refactor/809-sdk-boundary`
- [x] 3.1 ConversationMessage home in sdk/types; ui structural copy; private contract; type-single-home scans ui
- [x] 3.2 turn engine + recorder + thread-id + tool-access → @bakin/core; 20+ consumers repointed; old files deleted
- [x] 3.3 reply-toast body/attention/chime → ui; attention hook → sdk; `useAgentIdentity` (avatar) + raw-name headline; SDK wrapper + parity test; use-agent-store mock inventory; dir + fold shim gone; exceptions/migrations re-pathed
- [x] 3.4 Drawer → ui patterns; src/components/ui shims deleted; six arch suites + RTL mocks + Drawer exception rows re-pathed; census regenerated
- [x] 3.5 sdk-app-boundary test; check-cycles stale-checks tolerated entries
- [x] 3.6 docs (+ generated SDK reference committed)
- [x] Bits compatibility proof (assembled SDK + exact Bits usages typecheck: tsc exit 0)
- [x] PR 3 merged (#1022, 2026-10-22)

## PR 4 — #809b `refactor/809-sdk-hooks`
- [x] 4.1 map-audit-message + self-update-verify → core; host-state types → sdk/types
- [x] 4.2 browser-notify → sdk/internal (+ sendBrowserNotification on hooks); spend bridge deleted; hard-nav pins re-pathed
- [x] 4.3 the 19 hooks → packages/sdk/src/hooks; every import + mock re-pathed; full suite
- [ ] 4.4 allowlist shrinks to plugin hooks; docs
- [ ] Bits compatibility proof repeated
- [ ] PR 4 merged; #809 closed

## After the batch
- [ ] memory file for the batch updated (outcomes, lessons)
- [ ] Mark's manual sweep on main; no release
