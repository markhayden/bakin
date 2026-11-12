# Evidence: real-home first-run pass (onboarding hardening, PR 5)

Date: 2026-11-12. Machine: the maintainer's dev Mac (Apple silicon, macOS).
Code: branch `feat/onboarding-setup-checklist`, run from source
(`bun --no-env-file cli/bakin.ts …`; compiled binaries are killed on this
machine).

## What this pass is

The child-process harness cannot cover three things: the real search
engine download, the real model pulls, and the OS-supervised search
service. This pass runs a first-time onboarding against the REAL `~/.bakin`
and the real search service to cover them, then removes everything again.

Setup, as approved by the maintainer immediately before the pass:

- Deleted, no backup: `~/.bakin` (242 MB, onboarded 2026-06-01), the
  `io.bakin.antfly` launchd unit, `~/.antfly` (2.6 GB).
- Never written: `~/.pi`, `~/.openclaw`. The runtime was Pi, pointed at a
  throwaway Pi home (`PI_HOME`, `PI_CODING_AGENT_DIR`) holding a COPY of
  `~/.pi/agent/auth.json`. The copy was deleted at teardown.
- `~/.openclaw` holds no `openclaw.json`, so OpenClaw was not "found";
  detection saw Pi only.

## Timeline

| Step | Command | Result | Time |
|---|---|---|---|
| Wipe | `launchctl bootout`, remove the plist, `rm -rf ~/.bakin ~/.antfly` | all three gone, nothing on 3737/3738 | — |
| Check on a machine with no home | `bakin onboard --check --json` | exit 2; runtime `pi` / `detected`; **created `~/.bakin/logs/server.log`** (finding 1) | 0.6 s |
| Same, after the fix | `bakin onboard --check --json` | exit 2; no `~/.bakin`, no `~/.antfly`, nothing new in the Pi home | 0.6 s |
| First run | `bakin onboard --yes --json` | **exit 1, no marker** (finding 2); everything except `recommended-plugins` succeeded | 310 s |
| Rerun, after the fix | `bakin onboard --yes --json` | exit 2, marker written, resumed without redoing work | 2.4 s |
| Claim the service | `bakin install search --yes --json` | `noop`: engine installed, service provisioned and running | 1.3 s |
| Start | `bakin start` | "Bakin ready on http://localhost:3737", 14 plugins loaded, no errors in the log | ~10 s |
| Doctor | `bakin doctor --full` | `core.onboarded` OK; search connected, supervised via launchd, canary answered from all 10 tables; Pi auth OK | — |
| Teardown | stop server, `launchctl bootout`, remove plist, `rm -rf ~/.bakin ~/.antfly`, remove the throwaway Pi home | machine clean | — |

Dispatch was paused in `~/.bakin/settings.json` before `bakin start` so the
doctor's escalation could not send a real agent turn on the copied login.
That is the reason the doctor reports "Dispatch is paused".

## First run, step by step (`bakin onboard --yes --json`)

| Component | Outcome | Time | Message |
|---|---|---|---|
| mkdir | ok | 4 ms | Created 17 paths |
| settings | ok | 0 ms | Wrote settings.json (runtime: pi) |
| runtime | ok | 13 ms | pi runtime adapter is available (provisioned) |
| llm | ok | 1 ms | 1 LLM provider configured: openai-codex |
| search | ok | 6.3 s | Installed Antfly v0.2.5 (checksum verified) |
| search-models | ok | 294.5 s | Pulled 3 models: default embedder, visual embedder, reranker |
| media | ok | 16 ms | sharp available from node_modules |
| openclaw-integration | skipped / not_applicable | — | |
| plugin-assets | warn | 3 ms | 5 plugin assets need install (the server installs them at boot) |
| agent-sync | warn | 1 ms | 3 findings (the server repairs them at boot) |
| models | ok | 28 ms | Model plan applied: agent and chores on openai-codex/gpt-5.5 |
| budget | ok | 0 ms | No spend limits set |
| channels | ok | 1 ms | Discord delivery is disabled |
| recommended-plugins | **error** | 3.6 s | messaging, projects: `contributes.cliCommands[0].args is required when dispatch is declared` |
| recommended-agents | ok | 2.7 s | Installed official agent package: enrich |
| capabilities | ok | 2.5 s | Installed web-search-brave; 1 needs configuration |

Summary line: `{"exitCode":1,"markerWritten":false,"runtime":{"adapter":"pi","source":"detected"}}`.

On disk afterwards: `~/.bakin` 3.5 MB, `~/.antfly` 1.5 GB, the launchd unit
registered and running with `--data-dir ~/.bakin/antfly`, the engine
listening on 127.0.0.1:3738.

After the fix the rerun's summary:
`{"exitCode":2,"markerWritten":true,"runtime":{"adapter":"pi","source":"existing"}}`
with checklist `login done, search done, channels todo,
capability-key:web-search todo, model-plan done` and notes `start, explore`.

## Findings

| # | Finding | Where it belongs | What was done |
|---|---|---|---|
| 1 | `bakin onboard --check` on a machine with no Bakin home created `~/.bakin/logs/server.log`. The harness could not see it: its snapshots excluded `logs/`. | Onboarding | Fixed in this PR (`fix(onboarding): a check does not create the home to write a log`); the check scenarios now snapshot `logs/` and assert no home is created. |
| 2 | One optional extra failing (`recommended-plugins`) made the whole first run exit 1 with no marker, on a home that was otherwise fully set up. | Onboarding | Fixed in this PR: a recommended extra that cannot be installed is a warning (`optional_install_failed`), not an error. |
| 3 | Both recommended official plugins are rejected by `main`'s manifest check (`cliCommands[].args` required when `dispatch` is declared). | Plugin contract / Bits | Issue #1054. |
| 4 | The recommended `enrich` agent was installed pointing at a model this home cannot run; the first Health page showed it as Critical. | Agent packages / model routing | Issue #1055. |
| 5 | `bakin doctor` without `--full` reports offline results even while the server is running. Not a defect, but it reads like one after `bakin start`. | Doctor | Noted only. The setup guide tells people to run `bakin doctor`; consider whether it should say `--full`. |
| 7 | Teardown raced the engine: `launchctl bootout` returned while the engine was still exiting, and it recreated `~/.bakin/antfly/` (98 files) just after `rm -rf ~/.bakin`. A check in the same second said the directory was gone; it was found again 23 minutes later and removed. | Search service lifecycle | Removed by hand. Added to issue #1049: a removal verb has to wait for the engine to exit before deleting its data directory. |
| 6 | The model pull is the whole wait: 294 of 310 seconds, with no per-model progress in `--json` output. | Search setup | Noted only. |

## Verification of the boundaries

- `~/.pi` and `~/.openclaw`: a fingerprint of every path's mtime and size
  taken before the pass, after teardown, and again after the second
  cleanup is identical (1,088 paths).
- After teardown (and after removing what the exiting engine recreated,
  finding 7): no `~/.bakin`, no `~/.antfly`, no
  `~/Library/LaunchAgents/io.bakin.antfly.plist`, `launchctl print` finds no
  such service, nothing listening on 3737 or 3738.
- The copied `auth.json` existed only in the session scratchpad and was
  deleted at teardown.

## Not covered by this pass

- OpenClaw as the runtime on a real home.
- The interactive wizard against the real home (covered in the rig, in a
  real terminal session).
- A compiled binary (killed on this machine); the run was from source.
- Linux and the systemd unit.
