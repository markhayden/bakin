# Evidence — margo after the rc.42 upgrade (2026-10-23, read-only diagnosis + consented repair)

All times UTC. Box: margo (Pi runtime, launchd-supervised Bakin + antfly, Discord bridge). Source: `~/.bakin/audit.jsonl`, `~/.bakin/logs/server.log`, `~/.bakin/logs/antfly.log`, `/api/plugins/health/doctor`, `/api/updates`, `/api/approvals`, `/api/plugins/health/search-status`, task files.

## Timeline
| Time | Event |
|---|---|
| 14:13 | Last doctor run on rc.41: `actionRequired: 0`. |
| 14:25:49 | rc.42 boots. `antfly-adapter`: "provisioning failed — Search port 3738 is still occupied" (the rc.41-era 0.2.2 engine still bound the port while the adapter re-provisioned for the 0.2.5 pin). Adapter sets `initialized=false` for the life of the process. |
| 14:25:54 | First doctor sweep, 4 s after boot: 6 action_required. Escalation creates 3 `health-navigate` tasks (Team structural, OCR not ready, Transcribe not ready) and 1 delegated repair task `9f8c0eac` for main (terminal activation failed, search engine unavailable, plugin bins invalid). |
| 14:27–14:30 | main sub-delegates to patch (`26c87153`). patch runs `bakin plugins upgrade terminal`; it sits at `Continue? [y/N]` for 120 s (Pi shells have stdin=/dev/null; `readYesNo` never settles). patch blocks both tasks per the brief's integrity rules. |
| 14:30–14:33 | Mark by hand: syncs the five agents from the web UI, `bakin plugins upgrade terminal` (0.3.2→0.3.4) and `messaging` (→0.12.2) from a TTY, `bakin install search` (0.2.2→0.2.5, derived data cleared, engine restarted). The in-process adapter never re-probes. |
| 14:34–14:35 | Mark moves both blocked tasks to Todo; patch re-reads the brief and re-blocks ("no revised retry authorization"). |
| 14:35 | State: 4 action_required (team structural, search engine unavailable, transcribe not ready, ocr not ready), 1 watch, 3 pending approvals, 2 blocked + 3 review tasks. Engine answers 200 on 3738 while Bakin reports it unavailable. |
| 22:56 | Consented repair step 1: `launchctl kickstart -k` Bakin → adapter reachable, 12 tables "healthy" (empty). |
| 22:58 | Steps 2–3: `bakin packages sync ocr@0.1.0` (0.1.0→0.1.1 @ced0bb6), `transcribe@1.0.0` (→1.0.1). All five capabilities ready. |
| 22:59 | Step 4: `bakin reindex`. 2.5 min after boot the wedge watchdog judged the engine wedged (stale clock ran from boot; every registry table was TableNotFound engine-side), bounced it: stop OK, start refused "port 3738 still occupied" → unit left UNLOADED (KeepAlive cannot help). Reindex failed 12/12 (ECONNRESET then ECONNREFUSED); 3 tables parked. |
| 23:0x | Consented +1: `bakin install search --yes` re-provisioned the unit (NOOP install, restart). `bakin reindex` again: 24,323 docs, 12/12 healthy, 6 m 56 s. |
| 23:1x | Doctor: 0 action_required; the 3 navigate tasks auto-closed; approvals 0. Left: outbox 14 rows pending since 14:35 not draining (6 team, 8 tasks) → `stale-backlog` watch; `9f8c0eac` + `26c87153` still blocked (the sub-task is not linked to any request and never auto-closes). |

## Root causes (all in-repo)
1. **Sticky failed init in the search adapter** (`packages/adapter-antfly/src/adapter.ts:72-96`): one provisioning attempt at boot; any throw → "Search initialization did not succeed. Repair the service and restart Bakin" for the process lifetime; `bakin install search` succeeding later does not re-initialize the in-process adapter.
2. **Port-still-occupied is fatal in three paths**: boot provisioning (`ensureProvisioned` → `assertServicePortsReleased`, service.ts:466), the wedge watchdog restart (`restartService` = stop then start; the start asserts the port free immediately after bootout), and install. A socket in close/TIME_WAIT for a second is read as "an unrelated listener". The watchdog path leaves the launchd unit unloaded.
3. **Wedge watchdog false positive after a data wipe**: the progress clock starts at boot; with the derived data cleared every table query is TableNotFound, no progress is noted, and 150 s later the engine is "wedged".
4. **A Bakin release that tightens a manifest schema (#1004 `archive.extractedSha256`) invalidates installed packs** and nothing re-syncs them. The fix (`bakin packages sync <id>@<ver>`) is printed in four places and offered as a button in none; the updates record is `blocked` with a `manual` pointer; capability readiness and agent-sync each raise their own incident (Team's with an empty agent list and a `/team` link).
5. **Escalation fires on the first sweep after boot**, before anything can converge, and turns links into Review tasks + approvals.
6. **The delegated agent cannot pass a consent prompt** (no TTY guard in `promptUpgradeConsent`; `--yes` exists but the brief forbids improvising), and the brief tells it to block on first failure and never retry, so an operator requeue re-blocks.
7. **Self-update has no pre-swap compatibility check and no post-restart convergence** (`src/core/updates/self-update-operation.ts`): companions are only re-observed ~60 s after restart, and only as records.
8. **Outbox rows do not drain promptly once the engine returns** (14 rows pending for >1 h with the engine reachable) — to be confirmed in code during PR6.

## Counts behind the design
- 55 checks, 206 incident types: repair 35 / navigate 67 / instructions 47 / rerun 57; ~100 action_required of which 18 self-heal today.
- 27 repair actions: 15 safe / 2 manual / 8 destructive / 2 per-item.
- 31 human gates (14 CLI, 7 REST, 12 UI, 2 Discord); an agent is refused by the provenance policy for approvals, `updates apply`, `bakin update`, non-safe repair apply; it can run `packages sync`, `doctor --fix --yes`, `install *`, `plugins upgrade --yes`.
- 7 update sources: buttons exist for bakin/plugin/search-engine/search-models; package/hub-skill/gateway are text-only; nothing auto-applies.
- margo history: 65 Health repair tasks since 2026-07-22, nearly all archived unfixed.

Full inventories: `.claude/specs/self-healing-health-and-updates-2026-10-inventories/`.
