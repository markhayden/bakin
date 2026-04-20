# TODO: Issue #115 — Dispatch retry + transient cooldown

**Spec:** `.claude/specs/issue-115-dispatch-retry.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/115
**Branch:** `issue-115-dispatch-retry`

## T0 — Branch setup

- [ ] `git checkout -b issue-115-dispatch-retry`

## T1 — feat(openclaw): retry transient fetch failures in sendMessage

- [ ] Add `TRANSIENT_FETCH_CODES` + `isTransientFetchError()` to `src/core/openclaw-client.ts`
- [ ] Wrap `sendMessage` fetch in 3-attempt loop, 1s/2s backoff, transient-only retry
- [ ] Rewrite `tests/core/openclaw-client.test.ts` with fetch mock + 5 retry cases (preserve the 2 existing tests)
- [ ] Checkpoint: `pnpm vitest run tests/core/openclaw-client.test.ts tests/core/dispatch.test.ts` + `pnpm tsc --noEmit`
- [ ] Commit: `feat(openclaw): retry transient fetch failures in sendMessage`

## T2 — feat(dispatch): classify transient vs structural; shorter transient cooldown

- [ ] Add `transientCooldownMs: number` to `BakinSettings.dispatch` in `packages/core/src/settings.ts`
- [ ] Default to `60 * 1000` in `DEFAULTS.dispatch`
- [ ] Extend `FailureRecord` with `kind: 'transient' | 'structural'` in `src/core/dispatch.ts`
- [ ] Add `classifyDispatchError()` + `TRANSIENT_CODES` set
- [ ] Update `getFailureRecord()` normalizer to default `kind` to `'structural'`
- [ ] Cooldown-select-by-kind in `dispatchTasks` + `dispatchSingleTask` todoTasks loop
- [ ] Write classified failure records in both catch blocks + workflow dispatch drive-by (line 606)
- [ ] Update settings mock in `tests/core/dispatch.test.ts` to include `transientCooldownMs`
- [ ] Audit mocks in `tests/core/dispatch-assets.test.ts`, `tests/integration/usage-wiring-agent.test.ts`, `tests/core/settings.test.ts`
- [ ] Add 5 new tests to `tests/core/dispatch.test.ts` per plan.md
- [ ] Checkpoint: full `pnpm vitest run` + `pnpm tsc --noEmit`
- [ ] Manual smoke: kill gateway briefly during dispatch cycle, confirm task lands within one cycle
- [ ] Commit: `feat(dispatch): classify transient vs structural failures; shorter transient cooldown`

## T3 — docs(dispatch): document retry + cooldown classification

- [ ] Add "Dispatch Failure Handling" sub-bullet under CLAUDE.md "Key Patterns"
- [ ] Check if `.claude/knowledge/repo-architecture.md` covers dispatch — update only if it does
- [ ] Checkpoint: `pnpm vitest run` still clean
- [ ] Commit: `docs(dispatch): document retry + cooldown classification`

## T4 — Ship

- [ ] `git push -u origin issue-115-dispatch-retry`
- [ ] Open PR against `main`, reference #115, link related #114
- [ ] Merge when green
- [ ] Close #115 with PR link + before/after summary
- [ ] Archive `tasks/plan.md` + `tasks/todo.md`
