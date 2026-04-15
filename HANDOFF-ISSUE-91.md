# Handoff — Issue #91 Discord Approvals

Status: **7 commits ready on `main`**, unpushed. Pick up on the OpenClaw box and finish the loop.

## What's already done

Commits ahead of `origin/main` (oldest → newest):

| SHA | Subject |
|---|---|
| `b68701f` | `feat(workflows): add ApprovalActor type and StepState decision fields` |
| `fe7908f` | `feat(core): extract approver from Discord interaction payloads` |
| `e393c2c` | `refactor(workflows): approveGate/rejectGate accept options + capture timeline` |
| `e0890bf` | `refactor(workflows): preserve context in editDiscordGateMessage` |
| `7b4716f` | `feat(workflows): two-message Discord approval pattern + structured audit` |
| `bed612a` | `feat(workflows): thread reply for long gate prior outputs` |
| `023f3ac` | `docs(workflows): document approval audit fields and Discord pattern` |

134/134 tests green locally in `tests/plugins/workflows/` + `tests/core/discord-gateway.test.ts`.

Spec: `.claude/specs/issue-91-discord-approvals.md`
Plan: `.claude/specs/issue-91-discord-approvals-PLAN.md`
Knowledge: `.claude/knowledge/workflow-approvals.md`
Follow-up: GitHub issue **#98** (per-gate `notify_format` YAML — out of scope, deferred)

## Instructions for the OpenClaw-box Claude session

### 1. Sync

```bash
cd ~/go/src/github.com/madeinwyo/bakin  # or wherever the repo lives on that box
git fetch origin
git status  # should show main, clean, 7 commits ahead of origin/main
git log --oneline origin/main..HEAD
```

Expect exactly the 7 SHAs above. If the list looks different, stop and read `git status` / `git log` before doing anything.

### 2. Run the full suite (not just the targeted files)

```bash
pnpm typecheck  # pre-existing errors in search-auto-registration, search-tools-mcp, brainstorm-consumer, project-grid are NOT from this branch — ignore them. Any new error in plugins/workflows/ or src/core/discord-gateway.ts IS mine, fix it.
pnpm vitest run tests/plugins/workflows/ tests/core/discord-gateway.test.ts
# Optional but nice: pnpm test  (full repo)
```

If anything in workflows or gateway fails, do NOT push. Debug on the OpenClaw box and amend — that environment is closer to the real Discord bot so it may catch something the Mac didn't.

### 3. Push and open PR

```bash
git push -u origin main
# OR, preferred: move to a feature branch first so review is clean
git checkout -b feat/issue-91-discord-approvals
git push -u origin feat/issue-91-discord-approvals

gh pr create --title "feat(workflows): richer Discord approval notifications (#91)" --body "$(cat <<'EOF'
## Summary

Closes #91. Reshapes Discord approval notifications from a sparse "Gate Approved / Approved" card into a two-message pattern with full decision trace:

- **Awaiting card** edited in place on decision — preserves original embed fields, appends Decision + Decided by (GET-and-preserve with stripped-embed fallback on permission/deletion failure).
- **Standalone summary message** with the full record: gate label, gate description, workflow id, task id, step id, approver (displayName + source tag), requested-at + decided-at as Discord relative timestamps, humanized duration, optional reason, instance id in footer.
- **Thread overflow**: prior outputs > 1024 chars post the full text in a thread on the gate message (split across 2000-char chunks if needed).
- **Audit fields**: `gate.approved` / `gate.rejected` JSONL entries now carry `approver`, `gateLabel`, `requestedAt`, `decidedAt`, `durationMs` (and `reason` on reject). Memory plugin's audit view picks these up automatically.
- **Correctness fix**: REST handlers previously emitted audit source `'system'` for human clicks — flipped to `'web'` so `'system'` stays reserved for true non-human deciders.
- **Options-object refactor** on `approveGate` / `rejectGate` to prevent silent bugs when adding the new `approver` field alongside the existing `contentDir`/`rewindTo` params.

Follow-up issue #98 tracks per-gate `notify_format` YAML overrides — deferred until a real workflow needs to diverge from these defaults.

Spec: `.claude/specs/issue-91-discord-approvals.md`
Plan: `.claude/specs/issue-91-discord-approvals-PLAN.md`
Knowledge: `.claude/knowledge/workflow-approvals.md`

## Test plan

- [ ] `pnpm typecheck` clean for plugins/workflows and src/core/discord-gateway (pre-existing errors elsewhere are unrelated)
- [ ] `pnpm vitest run tests/plugins/workflows/ tests/core/discord-gateway.test.ts` — 134 tests green
- [ ] Verify Discord bot has `VIEW_CHANNEL`, `READ_MESSAGE_HISTORY`, `SEND_MESSAGES`, `CREATE_PUBLIC_THREADS`, `SEND_MESSAGES_IN_THREADS` on the approvals channel (documented in knowledge doc)
- [ ] Smoke: trigger a gate, approve via Discord, confirm awaiting card keeps its fields + summary lands with full record
- [ ] Smoke: approve the same gate shape via Bakin UI with Discord enabled — summary posts with `(web)` source tag
- [ ] Smoke: trigger a gate with a prior-step output > 1024 chars — preview in card, full text in thread

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 4. Post-push manual one-time ops (optional — do these only if you feel like it)

Per the plan's "Manual one-time ops on this machine" section, most items are **no action**. The only optional one:

- **Historical audit retag**: `'system'` → `'web'` for pre-#91 REST approvals. Only worth doing if you care about audit archaeology:
  ```bash
  rg '"gate\.(approved|rejected)".*"source":"system"' ~/.bakin/audit.jsonl
  ```
  Spot-check against task timestamps. Retag only entries you remember clicking yourself. Skip otherwise.

### 5. Cleanup

```bash
rm HANDOFF-ISSUE-91.md  # this file
git add -A && git commit -m "chore: remove issue #91 handoff note"
# or just git rm + commit
```

## If something breaks

The commit ordering was designed so each commit leaves the repo green independently. If you find a bug in the pushed work:

- **C1–C3** (types + runtime) — reverting these breaks later commits. Fix forward instead.
- **C4–C7** (Discord + docs) — each reverts cleanly in isolation. `git revert <sha>` is safe.

Spec + plan are in the repo as permanent record. Cross-reference them when debugging.

## Context the OpenClaw-box session won't have

- User approved: options-object signature for `approveGate`/`rejectGate`, `ApprovalActor` in `packages/core/src/plugin-types.ts`, audit source `'system'`→`'web'` flip for REST handlers.
- User decided: no deep links (Tailscale-only, no public URL), no per-gate YAML (→ #98), no migration code (single user, single machine).
- The `'system'` source is now **reserved** — zero callers today, but kept in the type so future auto-approve / watchdog work has a distinct tag.
