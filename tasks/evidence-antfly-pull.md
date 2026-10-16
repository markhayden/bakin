# Evidence: antfly `inference pull` behavior (operations T0 spike, #895)

Date: 2026-10-16. Engine: **antfly 0.2.2** (the pin; downloaded from
`releases.antfly.io`, sha256 `556a0121…ecbcc6` matches `pin.ts`). Machine: M4,
macOS. Model: `BAAI/bge-small-en-v1.5`. Every run used a disposable root with
**both** `HOME` and the models directory pointed inside it, asserted before
the first spawn. The real `~/.antfly`, `~/.cache` and the `io.bakin.antfly`
unit were never touched (checked after every run with
`find ~/.antfly ~/.cache -newer <marker>`: empty each time).

Settles spec D12 and spike 1 (partial-file location, resume behavior, cancel
cleanup, models point of no return).

## Findings

| # | Question | Finding |
|---|---|---|
| F1 | Which root does `pull` write to? | **`ANTFLY_HOME` is ignored by `inference pull`.** It writes to `$HOME/.antfly/inference/models` unless `ANTFLY_INFERENCE_MODELS_DIR` (env) or `--models-dir` (flag) is set; both are honored. Bakin's `inferenceModelsRoot()` honors `ANTFLY_HOME`, so under `ANTFLY_HOME` (tests, the rig) Bakin checks one directory while `runPull` fills another. Production is unaffected only because neither variable is set there. |
| F2 | Where do in-flight bytes land? | A sibling **staging dir**: `<models>/<owner>/.<name>.antfly-download-staging/`, holding finished files, the in-flight file as `<path>.part`, and an `.antfly-download-in-progress` marker. On success the staging dir is published as `<owner>/<name>/` with `.antfly-download-complete.json` (per-artifact `size` and `sha256`). The final model dir never holds a partial file. |
| F3 | What is downloaded? | Ten files including **both** `onnx/model.onnx` (133.1 MB) and `model.safetensors` (133.5 MB): ~267 MB, about **2× the pinned weight bytes**. The pins name only the files Bakin verifies, so pinned bytes are not the download total. |
| F4 | SIGTERM mid-file | Exit 143. No cleanup: the staging dir and `.part` stay. |
| F5 | SIGKILL mid-file | Exit 137. Identical leftovers. |
| F6 | Resume | The next pull **resumes at byte level** inside the `.part` (the progress line restarted at 56.6 MiB of 126.9 MiB) and re-verifies finished files as `cached` in ~0 s. After a SIGKILL during the second weight file, the re-pull finished in 22 s instead of ~85 s. |
| F7 | Lock | `<owner>/.<name>.antfly-download.lock` (0 bytes) persists after every run and does not block later pulls (an OS lock, not file existence). A **concurrent** pull of the same model **blocks silently**: it prints `pulling <model>...` and nothing else until the holder exits. |
| F8 | Output | stdout stays empty. stderr carries structured progress: `[i/N] <path> (<size>)...` when a file starts, `[i/N] <path> <done>/<size> (<pct>%) <rate> <elapsed> eta <eta>` **every 16 MiB**, `[i/N] <path> done (...)` or `cached (...)`, and finally `done.`. At ~3 MiB/s a progress line arrives every ~5 s; at 100 KB/s it would be every ~160 s. |
| F9 | Stall injection | **Neither** `ANTFLY_INFERENCE_HF_BASE_URL` nor `HTTPS_PROXY`/`https_proxy` redirect the download (the never-answering proxy saw zero connections; the pull completed from HuggingFace). A stalled model pull cannot be produced against the real binary. |

## Decisions (applied to SPEC D12 and PLAN 5.2)

1. **Progress source:** parse the stderr protocol (F8) for structure (file
   `i/N`, the current file's size) and poll the size of the current
   `<path>.part` in the staging dir (F2) for byte progress between the 16 MiB
   lines. One item per model; the item's `total` is the running sum of
   announced file sizes (it grows as files start). Pinned bytes are **not**
   used as a total (F3). Each stderr line also goes to `op.output`.
2. **Models directory:** `runPull` always passes
   `--models-dir <inferenceModelsRoot()>`, so check and pull agree under
   every home (fixes F1).
3. **Point of no return:** none during a pull. Publication is an atomic
   staging → final rename at the end (F2), and an interrupted pull is
   resumable (F6). Cancel is allowed at any time and sends SIGTERM. Models
   that already published stay installed (additive and idempotent).
4. **Cancel cleanup:** keep the staging dir. It is invisible to the
   completeness checks (dot-prefixed) and turns the next pull into a resume.
   No deletion code.
5. **Waiting on an external pull (F7):** Bakin's own pulls are serialized by
   the `search-engine` resource. A pull blocked by an outside process shows
   only `pulling <model>...` and goes quiet → the honest "stuck" state, with
   that line in the activity log.
6. **Stall tests (F9):** use a stub `antfly` executable that replays the
   stderr protocol and then stalls. The real-binary run in the disposable
   container covers completion and resume only.

## Reproduce

```bash
# 1. Pinned binary into a scratch dir (never ~/.antfly)
D=$(mktemp -d); curl -fsSL -o $D/a.tgz \
  https://releases.antfly.io/antfly/v0.2.2/antfly_0.2.2_Darwin_arm64.tar.gz
shasum -a 256 $D/a.tgz   # must equal pin.ts checksums['darwin-arm64']
tar -xzf $D/a.tgz -C $D

# 2. Disposable homes, asserted before any spawn
R=$(mktemp -d)
export HOME=$R/home ANTFLY_HOME=$R/antfly-home
export ANTFLY_INFERENCE_MODELS_DIR=$ANTFLY_HOME/inference/models
mkdir -p $HOME
case "$ANTFLY_INFERENCE_MODELS_DIR" in "$R"/*) ;; *) echo refuse; exit 2;; esac

# 3. Full pull; watch the staging dir and stderr
$D/antfly inference pull BAAI/bge-small-en-v1.5 2>$R/err & P=$!
#    ... sample: find $ANTFLY_INFERENCE_MODELS_DIR -name '*.part' -exec stat -f '%z %N' {} +
# 4. Interrupt: kill -TERM $P (or -KILL) mid-file, inspect, then re-run step 3:
#    stderr shows "cached" for finished files and resumes inside the .part.
# 5. Lock: start two pulls 3 s apart; the second prints only "pulling ..." until the first exits.
```

Runs on 2026-10-16: full pull ×4 (79–101 s each), SIGTERM at ~60 MB (resume
67 s), SIGKILL at ~200 MB (resume 22 s), concurrent pair, base-URL override,
never-answering proxy.

**Side note, unrelated to #895:** this machine's `~/.antfly/bin/antfly`
reports `0.2.0-rc.18` while the pin is `0.2.2`. That is the known
stale-local-binary situation; `bakin install search` updates it. It was left
untouched.
