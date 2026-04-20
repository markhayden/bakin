# TODO: Issue #115 — Dispatch retry + transient cooldown

**Spec:** `.claude/specs/issue-115-dispatch-retry.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/115
**Branch:** `issue-115-dispatch-retry`

## T0 — Branch setup

- [x] `git checkout -b issue-115-dispatch-retry` _(commit: `ed32d3c` chore: spec + plan scaffold)_

## T1 — feat(openclaw): retry transient fetch failures in sendMessage

- [x] Add `TRANSIENT_FETCH_CODES` + `isTransientFetchError()` to `src/core/openclaw-client.ts`
- [x] Wrap `sendMessage` fetch in 3-attempt loop, 1s/2s backoff, transient-only retry
- [x] Rewrite `tests/core/openclaw-client.test.ts` with fetch mock + 5 retry cases (preserved the 2 existing tests)
- [x] Checkpoint: `pnpm vitest run tests/core/openclaw-client.test.ts tests/core/dispatch.test.ts` + `pnpm tsc --noEmit` — clean
- [x] Commit `f74e139`: `feat(openclaw): retry transient fetch failures in sendMessage`

## T2 — feat(dispatch): classify transient vs structural; shorter transient cooldown

- [x] Add `transientCooldownMs: number` to `BakinSettings.dispatch` in `packages/core/src/settings.ts`
- [x] Default to `60 * 1000` in `DEFAULTS.dispatch`
- [x] Extend `FailureRecord` with `kind: 'transient' | 'structural'` in `src/core/dispatch.ts`
- [x] Add `classifyDispatchError()` + `TRANSIENT_CODES` set + `cooldownForFailure()` helper
- [x] Update `getFailureRecord()` normalizer to default `kind` to `'structural'`
- [x] Cooldown-select-by-kind in `dispatchTasks` + `dispatchSingleTask` todoTasks loops
- [x] Write classified failure records in both catch blocks + workflow dispatch drive-by (line 606)
- [x] Update settings mock in `tests/core/dispatch.test.ts` to include `transientCooldownMs`
- [x] Update mocks in `tests/core/dispatch-assets.test.ts`, `tests/integration/usage-wiring-agent.test.ts`
- [x] Add 5 new tests to `tests/core/dispatch.test.ts` per plan.md
- [x] Checkpoint: full `pnpm vitest run` (2833 passed) + `pnpm tsc --noEmit` clean
- [ ] Manual smoke: kick a task mid-transient-failure (deferred to post-review)
- [x] Commit `bded774`: `feat(dispatch): classify transient vs structural failures; shorter transient cooldown`

## T3 — docs(dispatch): document retry + cooldown classification

- [x] Add "Dispatch Failure Handling" sub-bullet under CLAUDE.md "Key Patterns"
- [x] Checked `.claude/knowledge/repo-architecture.md` — dispatch coverage is table-level only, not deepened
- [x] Checkpoint: `pnpm vitest run` still clean (2836 passed)
- [x] Commit `b8a49c7`: `docs(dispatch): document retry + cooldown classification`

## T3.5 — test(dispatch): coverage audit additions

- [x] AC6: workflow dispatch catch writes FailureRecord shape
- [x] Edge case: AbortError → transient
- [x] Edge case: unrecognized error → structural (safe default)
- [x] Checkpoint: `pnpm vitest run` (2836 passed | 1 skipped)
- [x] Commit `2744e6c`: `test(dispatch): cover AC6 workflow path + classifier edge cases`

## T4 — Ship (awaiting user go-ahead to push)

- [x] `/agent-skills:test` — audit coverage (all 7 AC mapped, gaps filled)
- [ ] `git push -u origin issue-115-dispatch-retry`
- [ ] Open PR against `main`, reference #115, link related #114
- [ ] Merge when green
- [ ] Close #115 with PR link + before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md`
