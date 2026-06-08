# T15 — Gold-standard E2E runbook (run together)

> The bulletproof acceptance gate. Real OpenClaw in Docker (`bun run instance …`), not the mock.
> Does NOT touch `~/.openclaw` or `~/.bakin`. Branch: `feat/bakin-owned-scheduler`.
> Rig deep ref: `.claude/knowledge/dockerized-openclaw-rig.md`. Commands: `instance up | dev | status | shell | run | down | reset`.

## Setup
```
git checkout feat/bakin-owned-scheduler
bun run build           # NOTE: rewrites a tracked version stamp — do NOT `git add -A` after (see MEMORY)
bun run instance up     # bring up the dockerized OpenClaw rig
bun run instance status # confirm gateway reachable
bun run instance dev    # run Bakin against the rig
```
Pick a fast cadence so we don't wait: in the schedule UI set **tick interval = 5s** and **catch-up window = small** for the downtime tests.

## The 9 scenarios (each MUST pass; capture evidence)

1. **No OpenClaw cron created.** Create a Bakin schedule (UI or `bakin schedule`). Assert the rig's `cron/jobs.json` gains **no** `bakin:schedule:*` entry (`instance shell` → inspect `~/.openclaw/cron/jobs.json`).
2. **Exactly-once fire.** Drive a schedule to its minute → exactly one Bakin task on the board; **zero** OpenClaw-originated agent turns; no duplicate channel post. (The original bug — must be provably gone. Watch the activity feed + the rig's trajectory dir.)
3. **Upgrade migration (gap-free).** Seed the rig with a *legacy* Bakin-owned OpenClaw cron (agentTurn payload, like the old Daily Scramble), start the new server → assert auto-cutover imported the expr into `~/.bakin/schedule/sidecar.json`, removed the OpenClaw cron, and the next fire is single-path Bakin with no rogue turn.
4. **Doctor repair.** Leave an orphan (simulate OpenClaw unreachable at activate) → `bakin check schedule-cutover` flags it → `bakin install schedule-cutover` completes migration → re-check clean.
5. **Downtime catch-up.** Stop Bakin across a fire time, restart **within** the window → task fires into **todo**; restart **outside** the window → task lands in **blocked** (`missed schedule window`); long outage → **one** coalesced task (not a burst).
6. **Pause / skip / overlap.** No fire while paused; skip-N honored; overlap guard blocks a concurrent task.
7. **Read-only surfacing.** Create a *native* OpenClaw cron directly in the rig → appears read-only in the schedule view; PUT/pause/delete on it → 403; Bakin schedules remain editable; `adopt` converts + removes the native cron.
8. **Prompt guard.** A schedule prompt with "do not split / under 1900 chars" shows the live warning in the form and returns `warnings` from the API.
9. **Restart idempotency.** Restart Bakin twice → no re-fire of past occurrences, no duplicate migration, no orphan.

## Acceptance
All 9 pass against real OpenClaw; `cron/jobs.json` holds no Bakin entries; the original double-post is unreproducible across repeated runs. Capture a short transcript/artifacts for the PR.

## Teardown
```
bun run instance down   # or `instance reset` to wipe the disposable home
```

## Deferred (decide during the run)
**T12 — recovered/repaired delivery-failure visibility.** Turn-killing delivery failures already surface via dispatch audit; the incident's recovered failures (agent posts via its message tool inside OpenClaw, then repairs) need trajectory tool-error introspection in the adapter — a separate session-forensics effort. The prompt-guard (scenario 8) attacks the root cause. If the live run shows we still want it, we scope it then.
