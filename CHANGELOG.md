# Changelog

All notable changes to Bakin are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with Bakin versions driven by git tags.

## [Unreleased]

Plugins can now bring their own binaries, and every plugin install or upgrade either lands completely or leaves nothing behind.

### Added

- **Plugin-managed binaries.** A plugin manifest can declare `requires.bins` (the same schema capability packs use). Bakin discloses the download in the install consent dialog and CLI prompt, checks the platform and pin conflicts before asking, downloads and sha256-verifies it into `~/.bakin/bin`, records it in the plugin lockfile, and removes it with the plugin unless a pack or another plugin still pins it. `bakin check plugin-assets` reports a missing or drifted binary; `bakin install plugin-assets` and the Health check's new one-click repair reinstall it.
- **Upgrade consent round trip.** `bakin plugins upgrade` and the Health inventory's Update action now preview, show the new permissions and downloads, and commit with a consent token bound to exactly what was shown — a plugin that changed in between asks again. Upgrades install re-pinned binaries and drop ones the new manifest no longer declares.
- **Install and upgrade progress.** Plugin installs and upgrades run as install jobs, so Explore shows staged progress, including binary downloads.

### Changed

- **Atomic plugin installs and upgrades.** Every change to `~/.bakin/plugins/<id>/` is one transaction: a failure — or a crash, recovered at the next boot — restores the previous directory, binaries and lockfile entry byte for byte. Half-installed plugins are invisible to the loader.
- `POST /api/plugins/upgrade` no longer accepts `yes`; it is two-phase (`{ pluginId }` preview, then `{ pluginId, accepted: true, consentToken }`).

### Fixed

- Removing a capability pack or rolling back a plugin install no longer leaves an orphaned `.installedBy` marker beside a deleted binary.

## [0.0.1-rc.39] - 2026-09-24

Navigation indicators are smaller, quieter, and kept current without opening each page.

### Changed

- **Count-free navigation dots (#933).** Expanded, collapsed, grouped, and mobile navigation now use small colored dots: green for unread updates, yellow for review or approval, and red for actionable problems. Agent work in progress alone does not light a dot.
- **Workflow approvals appear on Tasks (#933).** Pending approvals no longer advertise an unexplained Workflows badge; their indicator stays with the task where the decision can be made.

### Fixed

- **Indicators stayed stale until a destination was opened (#933).** Health diagnostics now refresh in the background, and navigation snapshots reconcile after reconnect, tab resume, and network recovery. Failed reads retain their last-known state and retry; older responses cannot restore obsolete indicators. Assets starts from an inventory snapshot, and Chat read and deletion changes propagate across tabs.
- **Health monitoring looked like an actionable alert (#933).** Only unsuppressed effective action-required incidents light the Health dot, in every sensitivity mode. Monitoring and advisory findings remain available inside Health.
- **Health updates could interrupt or bypass manual checks (#933).** Report events during Run checks queue a follow-up snapshot without aborting the diagnostic request. Starting Run checks during a cached read always runs diagnostics. Task-store changes now invalidate the affected Health checks using the actual event payload.

### Upgrade notes

- Upgrade Bakin before installing the companion official Messaging 0.11.7 and Projects 0.11.2 releases. They require rc.39 or later for shared reconciliation events and green unread-only conversation indicators.
- No data migration is required. In-page counts and browser-tab unread counts remain available; only main-navigation counts are removed.

## [0.0.1-rc.38] - 2026-09-24

A search-honesty patch: faceted asset search works again on libraries past a couple hundred assets and degraded answers are always labeled, the published SDK's rich-content entry imports outside a browser again, and Explore's capability rows keep their columns aligned.

### Fixed

- **Assets search silently degraded to text-only, flat-scored hits once the library grew (#930).** The Assets page asks for facet counts with every search, and antfly rejects any query that combines a semantic leg with aggregations once its embedding index holds more than about a thousand vectors — a couple hundred assets with chunked embeddings — with a misleading `query_candidate_budget_exceeded`. Bakin treated the rejection as an engine failure and served its scan fallback (every hit scored 0.1, no visual or text-embedding scores) without a log line, and the plugin search route dropped the degrade label, so nothing surfaced it; the global search overlay was unaffected because it never requests facets. Facets now ride a separate match-all count query while the hits keep full RSF fusion; a failed facet query omits the buckets with a label instead of degrading the hits; the scan fallback logs a warning; and plugin-scoped search responses carry the same `partial`/per-table budget labels as `/api/search`. The upstream limitation is pinned so it is noticed when antfly lifts it.
- **`@makinbakin/sdk/content` threw `document is not defined` when imported outside a browser (#929).** Since 0.0.1-rc.36 the packed rich-content entry is built for the browser target (so downstream plugin builds get vfile's browser helpers), but that target also selected `decode-named-character-reference`'s DOM build, which touches `document` at import — so the published entry could not be loaded under plain Node or Bun, and the release pipeline's post-publish SDK smoke has failed on rc.36 and rc.37. The content entry now pins that package to its universal build while staying browser-targeted; the SDK package test executes the packed entry without a DOM so this cannot regress.
- **Explore capability rows kept their columns and actions aligned (#928).** Long capability descriptions squeezed the category and runtime labels into broken words and wrapped the Details and Install controls, and installed skills placed their remove button below the text. Catalog columns are balanced, metadata stays beside its actions, removal controls sit next to the skill text, and the paste-a-link controls stack at narrow widths.

### Upgrade notes

- No reindex or migration for the search fix: facet counts come from a separate count query at request time, and existing tables are untouched. After upgrading, an Assets page search with the debug overlay on shows the text, visual and full-text leg scores again, and the doctor's search checks stay unchanged.

## [0.0.1-rc.37] - 2026-09-24

A single-fix patch for binary installs: the default workflows, workflow-step skills and runtime skills that every release binary has silently dropped since June now ship inside the binary, and the doctor tells you if a build ever loses them again.

### Fixed

- **Compiled binaries shipped no default workflows, step skills or runtime skills (#926).** Every install from a release binary booted with an empty Workflows page: the six default workflows (`text-social-post`, `image-social-post`, `video-social-post`, `video-script`, `clip-creation`, `assemble-video`), the three image workflows, their workflow-step skills, and the images plugin's installable runtime skills never registered, and `bakin check plugin-assets` reported that no plugin ships any. The loaders located `defaults/` relative to their own module file, which inside a single-file binary is a virtual `/$bunfs` path that never exists, and returned silently. Source checkouts were unaffected, which is why it went unseen since June. Plugin defaults are now embedded in the binary at build time and every loader resolves through one plugin-resources resolver (disk on a checkout, embedded copies in the binary). A compile-and-run regression asserts parity between a real binary and the checkout, and a new `workflows.shipped-defaults` health check raises an action-required incident if a build ever loses sight of its shipped workflows again.

### Upgrade notes

- Binary installs: after upgrading, the default workflows appear on the Workflows page at the next boot with no migration. Run `bakin install plugin-assets` once to install the images plugin's runtime skills, which the previous binaries could not see.

## [0.0.1-rc.36] - 2026-09-24

The Models & Spend overhaul lands: model selection is judged by whether a model can actually run here, spend limits become an opt-in you set from observed usage with a fixed notification ladder, and the Models page collapses to one plan with two lanes. Underneath, the browser kit finishes its table-first collection rollout and gains a shared form-control foundation.

### Added

- **Spend plugin: opt-in limits with a fixed notification ladder (#911, #921).** A new `spend` core plugin owns limits, billing lanes and pricing; the models plugin now owns only "which model". Limits are opt-in — no limit set is a healthy, plainly stated fact everywhere (no doctor warnings, no "uncapped" CLI lines, no onboarding prompt). The `/spend` page's guided **Add a limit** dialog suggests a monthly cap from what you actually spent on observed days (only after 14 covered days — never a guess), scoped to everything, one agent, or one provider, on either the metered-dollars or subscription-tokens lane; an optional daily cap and a reaction (wait for the next period, or pause matching work until you raise or resume). The ladder is fixed at 50 / 75 / 90 / 100 %: toast + OS notification at 50 and 75; at 90 and 100, persistent toasts the operator has to close (closing acknowledges; the cap toast carries Raise and Resume, and Resume is refused while still over). Milestones and incidents are durable rows delivered at-least-once. An incident names the other limits still holding work, and the Limits tab shows where every rule stands this period. `bakin budget set --monthly N [--daily N] [--at-cap wait|pause]`.
- **Model eligibility engine (#909, #907).** Whether a model can run here is now one verdict from four independent facts — in the catalog, available on the runtime (with the runtime's own reason), credentialed, and not rejected — overlaid on every catalog read. Every model picker keeps unavailable rows listed but disabled, with the reason ("no credentials for openai"), and a dead saved value renders in the danger tone (#922). Dead selections are held before the dispatch claim ("Model can't run" on the board), translated into real remediation in failures, flagged by a new `models.dead-selections` health check with a one-click repair, and reported (never rewritten) by the runtime switch. Restart-needed state is now advised by the adapter and persisted; Pi never needs one.
- **One write path for model selections (#909, #920).** Every persisted model reference is a selection with a stable ref, saved through `POST /api/plugins/models/selections`: serialized, revision-checked, eligibility-checked, with per-selection applied / failed / pending outcomes, full-state snapshots, and `bakin models restore` to undo. The old per-surface config, defaults, aliases and routing write routes are gone.
- **Simple/Advanced Models page and a recommended model plan (#912).** `/models` starts Simple: an **Agent model** lane (chat, direct messages, every task) and a **Background chores** lane (titles, enrichment, relay notifications, team routing, skill mapping), with "Set all to…" when the chores disagree. **Advanced** is a view over the same selections — Defaults, Agents, Work routing with tag overrides. **Use recommended plan** shows the exact diff with plain-words reasons and stages it; the same recommender backs `GET /api/plugins/models/plan`, `bakin models plan [--apply]`, the routing health check's apply-recommended-routes repair, and a new onboarding `models` step that applies only on confirmation (or `--yes` on a fresh install with no plan — an existing plan is never touched). Every edit stages into one draft with one save bar; "Reset to this plan" snapshots first and asks for typed confirmation. Deep links (`?ref=`) from the board and doctor land on the exact control.
- **Form-control foundation (#914).** Input, Textarea, InputGroup and Select share standardized `sm/md/lg` sizes (32/36/44 px) and outlined, filled and ghost appearances; textareas auto-grow within bounds; a new Combobox supports single and multiple selection with chips, grouped and rich options, and caller-owned async states.
- **Staged editing contracts and resize controls (#919).** Full-document managed-section rendering with bounded semantic Markdown comparison, AgentSelect appearance props, a visible composer focus ring, keyboard-reachable conversation regions, and atomic scoped plugin-data writes — the host prerequisites for staged Projects editing in the official Bits plugin. Drawer and conversation dividers gain visible grips with hover, focus and drag feedback, and clean up correctly when a drawer closes mid-drag or a second touch pointer arrives.

### Changed

- **Table-first collection rollout complete (#910, #806).** Tasks, Schedule, Health, Memory, Explore, Settings, Runtime, and the supporting Chat, Team, Assets and Branding lists now use the public DataTable for comparable records and separated rows for supporting lists, preserving URL sorting, search relevance, mobile metadata and action parity, independent menus and confirmation flows, and honest loading and error states. Galleries, calendars, boards, conversations and canvases stay as they were.
- **Model pickers describe why an option is dead (#922).** `ModelSelectOption` gains `description` and `tone`, and `SelectItem` gains `description` (exposed as the option's accessible description), replacing the interim label-suffix composition.
- **Models plugin is 3.0.0 (#912).** The four Models tabs, their `?tab=` links, and the Settings `defaultModel` field are removed in favor of the two-lane plan; the `models.configChanged` hook is replaced by `models.catalog_changed`.

### Fixed

- **Plugin compatibility gate handled release candidates wrong (#923).** The gate stripped every prerelease suffix, so a host on rc.34 wrongly satisfied `>=0.0.1-rc.35`, while an exact `0.0.1-rc.35` requirement rejected rc.35 itself. Requirements that explicitly target a prerelease of the same base version now compare the full host version; broad ranges and later release lines behave as before.
- **Positional fallback edits survived reloads badly (#920).** A reload landing mid-save could report "changes were discarded" after a successful save, and a stale positional request was judged against whatever list the page held at that moment. The draft is now ref-authoritative, positional ops carry the list they were compared against, and a save's own result is never mistaken for an external change.
- **Packed SDK content entry failed browser builds (#916).** Standalone plugin builds importing `@makinbakin/sdk/content` resolved vfile to Node-only modules; that entry now builds for the browser target.
- **UI conformance jobs could hang for six hours (#917).** The runner verified every fixture in one process, and repeated Chromium launches inside the CI container eventually wedged it with no deadline to stop it. Each fixture now runs in its own process under a 120-second deadline, and every CI job carries `timeout-minutes`.

### Upgrade notes

- **Spend settings move on first boot.** Limits and billing overrides migrate once from `~/.bakin/plugin-settings/models.json` to `spend.json`; the original is kept as `models.json.pre-spend.bak`. No limit was ever a real default, so an install that never set one comes up with none — the Spend page will suggest one once it has 14 observed days.
- **Anything scripting the old Models write routes must move.** `POST /api/plugins/models/{config,defaults,aliases}` and `PUT /api/plugins/models/routing` are gone; use `POST /api/plugins/models/selections`, or `bakin models plan --apply` for the recommended plan.
- **A model that can no longer run holds its tasks instead of failing them.** After upgrading, check `/models` for danger-toned selections and the `models.dead-selections` health finding; the one-click repair (or the picker's *Use <model>* callout) stages the replacement.
- **Official Bits plugins that pin `>=0.0.1-rc.35`** (Terminal, Projects) are now judged correctly by the compatibility gate; the Projects staged-editing release depends on this host.

## [0.0.1-rc.35] - 2026-09-21

Everything v0.0.1-rc.34 promised, actually shipped: rc.34's tag failed macOS signing (see Fixed below) and was never published, so its full contents land here.

### Added

- **Live install progress (#895, #902).** Package and agent-package installs run as jobs: the dialog shows completed stages, the current stage, a byte-level progress bar ("470 MB of 940 MB"), and elapsed time — over SSE with a status-poll net (`GET /api/install-jobs/:id`). Also removes a hidden 120-second client timeout that could report failure while the server-side install kept running. Every download leg (capability binaries, model files) reports real bytes.
- **Managed Bun runtime (#901).** Bakin now finds Bun in the well-known install locations daemon PATHs miss (`~/.bun/bin`, both Homebrew prefixes) — the actual cause of "bun not found" on a box that plainly had it — and when no Bun exists anywhere, installs its own sha256-pinned copy into `~/.bakin/bin`. No customer is ever told to install a dev toolchain.

### Fixed

- **Signed macOS binaries refused sharp's native module (#900).** The notarized binary's hardened runtime enables library validation, blocking any library not signed with our Team ID — rc.33's media store install correctly refused to commit at `different Team IDs`. Releases now sign with the standard library-validation entitlement (the Electron/VS Code posture), and the installer names the real remediation for this failure class.
- **The rc.34 signing failure itself (#905).** The new entitlements plist's comment contained a double hyphen — illegal inside an XML comment, rejected by Apple's AMFI parser at codesign even though `plutil -lint` passes it. Comment rewritten; the signing-plan test now bans the sequence outright.

### Upgrade notes

- macOS binary installs: after upgrading, the `media.sharp` health repair (or `bakin install media`) should complete in about a minute with visible progress — this is the release where image processing actually lands on signed builds.
- Packs with npm payloads (e.g. Browser Tools) now install on boxes where Bun lives in `~/.bun/bin` or nowhere at all.

## [0.0.1-rc.34] - 2026-09-21 [YANKED — tag never published; macOS signing failed (#905). All changes shipped in 0.0.1-rc.35.]

The second install-reliability patch from the production field test: signed macOS binaries can finally load the media store, Bakin finds (or brings its own) Bun on toolchain-free boxes, and anything that installs shows live staged progress instead of a spinner.

### Added

- **Live install progress (#895, #902).** Package and agent-package installs now run as jobs: the dialog gets a job handle immediately and renders completed stages, the current stage, a byte-level progress bar ("470 MB of 940 MB"), and elapsed time — driven by `packages.install_*` events over the shared SSE bus with a status poll as the net (`GET /api/install-jobs/:id`). This also removes a hidden 120-second client timeout that could report failure while the server-side install kept running and later succeeded. Every download leg (capability binaries, model files) reports real bytes through the one shared downloader.
- **Managed Bun runtime (#901).** Capability packs with npm payloads need a `bun` executable the compiled binary cannot provide. Bakin now finds Bun in the well-known install locations that daemon PATHs miss (`~/.bun/bin`, both Homebrew prefixes) — the actual cause of "bun not found" on a box that plainly had it — and when no Bun exists anywhere, installs its own sha256-pinned copy into `~/.bakin/bin` from Bun's official npm tarballs. No customer is ever told to install a dev toolchain.

### Fixed

- **Signed macOS binaries refused sharp's native module (#900).** The notarized binary's hardened runtime enables library validation, which blocks loading any library not signed with our Team ID — so rc.33's media store install downloaded, bundled, and then correctly refused to commit when the probe hit `different Team IDs` at dlopen. Releases are now signed with the standard library-validation entitlement (the same posture Electron and VS Code ship), and the installer translates this failure class into "upgrade to an entitled build" instead of sharp's npm advice. No test can catch regressions here — locally compiled binaries are unsigned — so the entitlements file and codesign flag are pinned as a pair by the signing-plan test.

### Upgrade notes

- macOS binary installs: after upgrading, the `media.sharp` health repair (or `bakin install media`) should now complete in about a minute with visible per-tarball progress in the server log — this is the release where image processing actually lands on signed builds.
- Packs with npm payloads (e.g. Browser Tools) now install on boxes where Bun lives in `~/.bun/bin` or nowhere at all.

## [0.0.1-rc.33] - 2026-09-21

An install-reliability patch, driven by a production incident: downloads can no longer hang forever, health reporting can no longer be fooled by a forged receipt, and delegated repair agents now carry explicit integrity rules.

### Fixed

- **Installs hung forever on a stalled download (#897).** On a production box, the media-store repair, Extend capability installs, and agent-run `bakin install media` all sat on "applying and verifying" indefinitely: the underlying transfer had wedged mid-body, and the 120-second timeout only ever guarded the request's header phase — once streaming started, a stalled connection hung the installer for good. The shared downloader now reads the body chunk-by-chunk under a 30-second no-data window plus an overall deadline, retries once on a fresh connection (the observed wedge is per-connection; a fresh attempt succeeds), never retries checksum mismatches, cleans up partial files, and logs per-item progress lines so a long install is visibly alive in the server log. Capability binaries and model downloads ride the same engine and heal with it. Orphaned staging directories from killed installers are now swept automatically.
- **Health reporting now proves image processing works instead of trusting receipts (#897).** During the same incident, a delegated repair agent hand-built a broken media store and forged its install receipt — which made the doctor report healthy while enrichment kept failing, and bricked the repair path (the idempotent installer saw a receipt and skipped). The `media.sharp` check and the `media` onboarding component now verify the sharp bundle actually loads before reporting healthy; a receipt that doesn't load raises an action-required "store broken" incident, and every repair path force-reinstalls straight over it.
- **Delegated repair briefs forbid making things up (#897).** Health-repair tasks handed to an agent now name each incident's sanctioned fix (the one-click repair, the exact command, or "this needs the operator") and close with non-negotiable integrity rules: sanctioned paths only, never hand-create Bakin-internal state (receipts, stores, lockfiles, markers, databases), and a clearly reported failure is a success outcome — a fabricated fix is the worst possible one.
- **Release-pipeline story flake retired (#894).** The `AssetLibraryPicker` visibility assertions that cost rc.32 a failed-job rerun now wait for the dialog transition instead of racing it.

### Upgrade notes

- If a previous install attempt left the media store missing or broken, the `media.sharp` health finding's one-click repair (or `bakin install media`) now completes or fails loudly within about a minute — and reinstalls cleanly even over a corrupt store.

## [0.0.1-rc.32] - 2026-09-21

An image-pipeline patch: compiled-binary installs get working image processing by default, the Workflows page moves to one sortable table, and three honesty fixes keep review state, watchdog logs, and task descriptions from crying wolf.

### Added

- **Zero-install image processing on compiled binaries (#889, #891).** `bun build --compile` can never carry sharp's native prebuilds, so every binary install silently ran without image support: enriching any image over 2 MB failed with a retry that could never succeed, asset exports threw, thumbnails degraded, and visual search lost its thumbs. Binary installs now provision a probe-verified media store (`~/.bakin/media/`, ~8 MB of sha256-pinned prebuilds bundled by the binary itself) automatically during onboarding — with `bakin install media`, a `media.sharp` health check, and a one-click repair that takes effect without a server restart for existing installs. Source installs are unchanged. A compile-and-run regression pins the whole chain on both macOS and Linux, including a tripwire that fires if bun ever learns to embed sharp natively.

### Changed

- **Workflows in one sortable, source-filtered table (#885).** The separate card sections are replaced by a single SDK DataTable with URL-backed source and sort controls and 20-row pagination, preserving workflow summaries, provenance, assignments, and step previews. Page filter bars across the fleet share one indicator treatment, and the InputGroup keyboard focus ring is restored.

### Fixed

- **The task drawer says so when workflow state can't load (#892).** A workflow task whose instance fetch failed (server mid-restart, 5xx) rendered no review surface at all — a Review-column task with silently absent approval controls reads as a broken approvals feature. The drawer now shows an explicit "Workflow state unavailable" alert with a retry; a workflow that simply hasn't started stays silent as before.
- **Budget-held workflow steps no longer masquerade as hung (#892).** A step whose dispatch was deferred by a spend cap collected a misleading watchdog `TIMEOUT` log entry every five minutes (81 in one overnight run) and could even escalate to blocked. The watchdog now probes the same budget gate dispatch defers on and writes a single `BUDGET HOLD` note per hold; timeout handling resumes the moment the cap lifts.
- **Template-placeholder image URLs render as text (#892).** Agent-authored markdown like `![Taco](/api/assets/<assetId>)` fired a guaranteed-404 image request with console noise; the reference now stays legible as inline code.

### Upgrade notes

- Compiled-binary installs: the doctor will raise a `media.sharp` action-required finding after upgrading — use its one-click repair (or `bakin install media`) to provision image processing; no restart needed. The onboarding version also bumped, so `bakin onboard --yes` re-runs cleanly on existing installs.

## [0.0.1-rc.31] - 2026-09-21

A single-fix patch: the Pi runtime works on compiled-binary installs.

### Fixed

- **Pi runtime was dead on compiled binaries (#886, #887).** The pi SDK loads its per-provider OAuth modules (and the bedrock provider) through deliberately bundler-opaque dynamic imports, which cannot resolve inside a `bun build --compile` binary — so on a binary install, switching to the Pi runtime failed every turn instantly with `OAuth auth derivation failed for openai-codex: Cannot find module './openai-codex.js'`. The adapter now registers statically imported modules at startup, the same way the SDK's own standalone binary does. Source installs (`bun run dev`) were never affected. Regression coverage compiles real binaries both with and without the registration, so this class of only-breaks-in-the-binary failure is now caught before release.

## [0.0.1-rc.30] - 2026-09-20

A routing-recovery patch: work-class model routing works again on OpenClaw 2026.9.5, with honest receipts and health findings whenever a gateway refuses per-turn overrides — plus the collection UI foundation for rows, cards, and comparison tables.

### Added

- **OpenClaw override-authorization health check (#880, #882).** The adapter's first canonical health check verifies the gateway connection may carry per-turn model overrides whenever work-class model routes are configured. An unauthorized connection with routes raises an action-required incident with exact remediation (pair the device with `operator.admin`, or clear the routes); before the connection reports its granted scopes the check says "unknown", never a guessed healthy. The models plugin adds a matching `routes-model-clamped` warning so the routing config side tells the same story.
- **Collection recipes and section headers (#879).** Three documented collection families — divider-separated rows for text-first browsing, preview cards, and comparison tables — with optional record menus, compact disclosure actions, and an approved section-header treatment on `ListRowGroup` (opt-in styling, neutral rail default, accessible heading level). Existing row defaults and plain group headings are unchanged; this is the Storybook-contract foundation the fleet migrates onto (refs #806).

### Fixed

- **Work-class model routing on OpenClaw 2026.9.5 (#880, #882).** 2026.9.5 gates per-turn provider/model overrides behind the `operator.admin` scope, and Bakin connected with read+write only — so every routed turn (enrichment, auto-titles, relays, routed dispatch) failed instantly with `INVALID_REQUEST`, which on one production box silently starved asset enrichment and degraded asset search to keyword-only. The adapter now requests admin as an optional connect scope (loopback self-pairing grants it for free; a refusing topology downgrades gracefully exactly once, only on evidence that the refusal was about the optional scope), derives the `perTurnModel` capability from the connection's actual granted scopes, and Bakin clamps routed models pre-send when the gateway won't honor them — turns proceed on the agent's default model with clamp receipts (`task.routed`, a `route.model_clamped` audit per standing denial, and spend never attributed to a model that didn't run) instead of failing. A mid-session revocation retries the affected turn once on the agent default with a receipt, and re-granting admin takes effect on reconnect without a restart.

### Upgrade notes

- If you cleared your work-class model routes to work around #880, restore them after installing this release, then confirm the `openclaw.override-authorization` health check reads healthy.

## [0.0.1-rc.29] - 2026-09-20

A compatibility and trust patch: the OpenClaw adapter speaks the 2026.9.5 agent registry, and model availability now reflects what your account can actually call instead of what a provider catalog claims.

### Added

- **Model availability is account-verified (#852, #872).** When a provider deterministically rejects a model id (a retired or unentitled model), the failure is recorded as durable evidence: the model flips to unavailable everywhere with a "Rejected by account" badge, the routing recommender stops proposing it, and the `models.routing` health check says exactly what happened ("rejected by your account, N failures, last seen …") with an action-required finding for any route still pointing at it. A later successful call or probe clears the record automatically. Previously a retired model stayed "available" for ten days while four subsystems failed against it.
- **Verify availability on demand (#852, #872).** The Available Models tab gains an explicit "Verify availability" action that fires a tiny billed probe per configured-provider model and reports per-model verdicts (verified / rejected / skipped). Probing is strictly manual — background refreshes and schedules never probe.

### Changed

- **OpenClaw 2026.9.5 agent registry support (#873, #876).** The adapter reads the keyed `agents.entries` registry natively, restoring the full roster in the Team UI, agent APIs, MCP provisioning, and package adopt/sync (previously a migrated config collapsed to a single synthesized Main, and reinstalls failed with contradictory missing/already-exists errors). Writes always land on `entries` — Bakin never authors the legacy `agents.list` again — and an older list-shaped config still reads correctly, upgrading one-way on its first edit. An explicitly empty or `ownership: "explicit"` registry now renders honestly empty instead of fabricating a Main agent. Boxes where Bakin edits agents should run OpenClaw ≥ 2026.9.5.
- **SDK surface cleanup (#804, #875) — breaking for plugin authors.** Nine unused public exports (three hooks and six helper re-exports) are removed from the focused SDK entrypoints; no entrypoint subpath is removed. Regression coverage now validates the built SDK's export surface directly.
- **Dispatch stops retrying models the account cannot call (#852, #872).** A model-rejection failure blocks the task immediately with routing remediation instead of grinding half-hour retry cooldowns against a deterministic error, and the failed attempt's evidence names the exact model.

### Fixed

- **Billed image generation survives a retired carrier model (#852, #872).** If the configured Codex carrier is rejected by the account, generation falls back to the maintained default carrier and completes, recording the rejected rung as availability evidence; the result metadata reports which carrier actually ran. Fallback only triggers on model rejection — never on rate limits or auth errors, which could double-bill.
- **A corrupt `openclaw.json` is never overwritten (#873, #876).** The agent-creation fallback previously replaced an unparseable config with a near-empty file, losing the gateway token and channel settings; every config mutator now refuses to write over a corrupt file.
- **Release pipeline smoke-tests the published SDK (#871).** The publish job validates the current package's exports before release instead of trusting the previous version's surface.

## [0.0.1-rc.28] - 2026-09-20

A search-focused release with faster indexing, relevance reranking, and more accurate health reporting, alongside shareable workspace views and a calmer badge hierarchy.

### Added

- **Shareable task and workflow-step drawers (#839, #840).** Opening a task or workflow step now updates the URL, so links and refreshes reopen the same item and browser Back closes the drawer. Task links resolve even when the task is outside the current board filters; missing tasks show a dismissible message.
- **Links preserve more of your workspace (#842, #850, #853, #856).** Asset links can select a specific version, brand-document links retain Edit/Preview mode, and Health links retain the Tokens/Reported cost chart selection. Chat search lives in the URL, and both search and agent filters survive switching conversations.
- **Search progress explains what the engine is doing (#862).** Index health and reindex progress now carry engine-reported activity phases, stall reasons, and progress evidence. A declared embedding stall is detected immediately instead of waiting for the usual no-progress window; index cutovers still require the existing count-based convergence checks.

### Changed

- **Antfly upgraded from 0.2.0 to 0.2.2 (#858).** The new engine fixes the populated-table index-creation wedge and improves background indexing throughput. In the recorded M4 evaluation, fresh-table backfill throughput improved from roughly 4 to 65–70 documents per second, and rebuild-under-load probes completed without failures. Existing embedding models are unchanged.
- **Search reranking is enabled by default (#864, #866).** Eligible single-table searches use the reranker, while the first page of cross-table search reranks its merged top 20 results in one batch rather than competing across tables. Explicit opt-outs are respected; cross-table results retain their original search order if the reranking pass is unavailable. The adapter delegation fix ensures the merged-result pass actually runs.
- **Pi runtime and model catalog updated (#854).** Pi moves from 0.80.3 to 0.85.1, adding the GPT-5.6 family to its bundled catalog and reading Pi's refreshed model catalog. The default model used to carry Codex image-generation requests changes to `gpt-5.6-luna`. Existing user-selected routing models are not rewritten.
- **Clearer badge hierarchy across the app (#863, #867).** Header counts and task-team labels use softer treatments; Health interaction summaries and incident metadata stay quiet beside solid primary states. Recent-event and agent-row status chips are smaller, System states are filled, and link badges have a subtle underline. Storybook now makes the available treatments and real usage examples easier to compare.

### Fixed

- **Search installs no longer report success with a stopped engine (#860).** Installation repairs unloaded or inactive service registrations and waits for the engine to answer. If startup never completes, the command fails with diagnostic guidance instead of claiming the service is running.
- **Recovered indexes no longer stay permanently unhealthy (#861).** Historical embedding errors are retained as advisory evidence when a leg is otherwise ready, with a targeted rebuild action. Live failures and stalls still report unhealthy status.
- **Removed indexes stop producing phantom cleanup warnings (#851).** Cleanup now retires records for tables the engine confirms are already gone, while preserving genuine failures for retry.
- **Filtered Chat no longer enters a React update loop (#856).** Opening Chat with an agent filter now renders normally.
- **Workflow approval notifications open the intended task (#839).** Task links now go directly to `/tasks?taskId=...` instead of losing the task selection through the root-page redirect.

### Upgrade notes

- After updating Bakin, run `bakin install search` to install Antfly 0.2.2, then `bakin reindex` to rebuild the derived search indexes. The engine-version change clears its derived index data; source content and downloaded models are preserved. Allow the rebuild to converge, then verify with `bakin check search` and `bakin check search-models`.

## [0.0.1-rc.27] - 2026-09-18

The release that ships persistent shared terminals and makes every setting a link — on top of the Antfly 0.2.0 search stabilization and Hub skills that landed earlier in the window.

### Changed
- **Antfly v0.2.0 final adopted — the rc-era siege lifts (`tasks/evidence-antfly-0.2.0.md`).** Six weeks after the rc.19–rc.21 evaluation ended in a crash dossier and a re-pin to rc.18, the official 0.2.0 release passed the full hard gate on the target M4: the R4 concurrency killer survived a 45-minute 3-stream embed soak (9,843 batches, zero failures — rc.21 died in 51 seconds), the #382 poison-read and #386 hot-queue-drop crashes are gone, the one-way table migration (#383) became loud two-way refusal with bytes untouched, and the #319 lying-flags family is fixed at scale. The headline: **search stays fully usable during a reindex** — 10,483 queries against a live 20k-doc backfill returned zero failures at 1ms median, where rc.18 measured 194ms median, multi-second tails, and 15 failures on the identical procedure. With the blockers disproven, six rc-era workarounds came out one commit each: filters ride `filter_query` again (and filtered searches now keep semantic recall — the no-leak property is probed and guarded), the #319 and empty-table health overrides retired, the dead rc-era wedge signatures replaced by the one 0.2.0 actually emits, the process-wide write serialization gate removed, and blue/green backfills switched to sync writes on the engine's fast embed lane (~20× the paced async catch-up path). Two new 0.2.0 sharp edges are ticketed upstream and steered around: inline indexes at table-create are silently dead (legs now go through the per-index endpoint, always before the first write) and adding a leg to a populated table wedges it durably (never Bakin's flow; watchdog signature added). The server subcommand is `standalone`; upgrading is a rebuild event as always — `bakin install search` + repair reindex.

### Added
- **Terminal — persistent shared terminals with per-agent access (#828).** A tmux-backed terminal you and your agents share: open a session in the browser, reattach to it from any device over Tailscale (start one from your phone), and watch an agent work in a live terminal — taking over with a keystroke when it goes off the rails and handing back automatically when you go idle or navigate away. Sessions are named, segmented (Active / Needs review / Completed / All), and always deletable. Repo work runs in a retained git worktree (the branch is the deliverable, torn down only on a clean, provably-merged finish), and agents drive their own sessions through an identity-bound exec tool that can only touch what they're assigned. Access is per-agent and **opt-in** — only the main agent is enabled by default, because a terminal is a real shell running as your user: an enabled agent can read your on-disk secrets, so the enable-agent setting says so in as many words. Powered by new SDK surface shipped here for plugin authors: the `agent-toggles` settings field (a per-agent avatar grid), `DropdownMenuSwitchItem`, and verified-agent exec-tool binding. Install it from onboarding or Explore → Capabilities.
- **Every setting is a link (#829, #830).** The Settings and Team pages now put their category in the URL (`?tab=`) and let a producer link straight to a single field (`?field=`): a health incident's "fix this" now lands you on the exact setting, tinted and scrolled into view, with the form fully editable and focus never stolen. Health, runtime, and image resolutions deep-link to their category and field; `PluginSettingsRenderer` gains `highlightKey` so any plugin's settings inherit the same behavior.
- **Hub skills (#687)** — install Agent-Skills-format skills from ClawHub, GitHub skill repos, or local dirs onto whichever runtime is active. Paste a clawhub.ai/github.com link into `bakin skills install` or the Explore → Capabilities install box; every install shows a trust preview (files, translated requirements, hub security verdict, instruction-risk warnings) behind a consent gate — hub-flagged malware is refused with no override, versions are pinned, provenance recorded. `bakin skills {install,list,remove,map}`; `skills map` dispatches an agent to map unrecognized requirements with mechanically verified output. Also: Pi adapter now projects nested skill files with exec bits on scripts, `runtimes`/`platforms` manifest gates are enforced server-side at install, and secret saves live-inject declared env vars (no more restart after the guided key step).
- **Storybook is the executable contract — three-tier catalog + live playground (#783–#803).** Public Storybook is reorganized into Tokens / Components / Recipes, every public component gains real interactive controls (a playground, not static stories), and Recipes document composed patterns like filterable-table and form-in-drawer. Underneath, a fourth kit-conformance pass moved the official surface fully onto the shared design system — DataTable self-sorts any table with headers, typography/tabs/table primitives relocated into the kit, host chrome migrated, and the kit's shared internals got a written contract with story-compliance and controls ratchets that enforce it. Mostly plugin-author-facing — and the reason the Terminal plugin above composes the kit end-to-end without a single escape hatch.

### Fixed
- **Assets debug overlay + tasks board polish (#813–#816).** The debug score overlay no longer covers the selection checkbox (top-aligned, flush-right to the size callout), and the tasks board fills viewport height so its scroll rail pins to the window bottom.

## [0.0.1-rc.26] - 2026-07-24

The patch that closes the three-release "Git worktree registry could not be verified" mystery (#725) — and with it, the last known way a health check could destroy its own findings.

### Fixed
- **A real finding was hiding behind its own resource id (#725).** The git worktree check on an affected machine wasn't crashing: it had found a genuinely stale task worktree and reported it — with the worktree's filesystem path as a resource *id*, which the contract's stable-key format rightly rejects. The whole run was discarded into a generic Verify card, hiding a legitimate action-required finding since rc.22 (the rc.25 instrumentation finally named the failing field). Resource ids and labels now normalize at the shared observation builders: contract-invalid ids sanitize deterministically via the new `healthResourceId()` (already-valid ids pass through untouched), labels trim and bound to 120 characters, and the git producer carries paths in `label` where they belong. The sweep also defused the next landmine of the class before it fired — the tasks check put unbounded task titles into resource labels, so a single 121-character task title would have nuked the tasks card the same way.
- **The run-workspace first-sweep card stops squatting in Fix first (#725).** "Run-workspace usage unknown" right after boot is a warming state the watchdog's first pass resolves within minutes — it is now advisory (same treatment as the transcript-scan warm-up), and its copy says it resolves itself, with Sweep now available for an immediate measurement.

## [0.0.1-rc.25] - 2026-07-23

A one-fix hotfix for rc.24.

### Fixed
- **"Health report response was invalid" after restart (#723).** rc.24's advisory-unknowns contract widening missed the client-side wire mirror, which still pinned unknown incidents to watch-only — so the first advisory unknown a server emitted (the scan-warm-up card, minutes after every restart) made the client reject the entire health report. The dashboard showed the error banner over an otherwise healthy overview until the scan finished. The mirror now matches the producer contract, with a regression test holding the two in lockstep.

## [0.0.1-rc.24] - 2026-07-23

The Health-honesty patch (#720), one day after rc.23. Field testing rc.23 on two machines exposed the next layer: health cards that told you something was wrong without telling you what, instructions that referenced UI that doesn't exist or asked a human to trigger machine operations, and a dashboard that lit up after every restart with states that resolve themselves. The standard this release enforces: **a health card names its exact evidence, resolves with one click wherever the fix is deterministic, and self-resolving states never masquerade as things you must fix.**

### Added
- **One-click spend-evidence repair (#720).** The "Spend evidence is incomplete" card now enumerates its actual gaps by model and reason ("openai/gpt-5.5: unpriced — 3 runs"; daily/monthly windows deduped) and, when the gap is missing pricing, offers a **Refresh model pricing** repair that force-refreshes the model catalog server-side through the new `models.refreshAvailableModels` hook — replacing an instruction to go visit the Models page. Failure modes are honest and specific: models plugin inactive, provider returned zero models (points at `bakin check llm`), fetch error surfaced verbatim — and success never overclaims (a model with no known pricing stays honestly uncapped-by-dollars).
- **Advisory unknowns (#720).** The health contract now lets a producer mark an unknown as *advisory*: "this self-resolves, don't page anyone" — a transcript scan warming up after a restart, billing attribution completing as sessions land. Advisory unknowns show in the quiet advisories strip instead of the **Fix first** banner, which previously swallowed every unknown-status incident regardless of disposition or sensitivity — the reason a freshly restarted, perfectly healthy box greeted you with Verify cards. `action_required` unknowns remain unrepresentable: an unknown cannot honestly demand action.
- **Shared clamped observation builders (`@bakin/core/health/observation-builders`, #720).** The health observation builders moved into core so adapter packages construct through the same protected path as plugins (`@makinbakin/sdk/utils` re-exports unchanged; the Pi adapter's raw-literal helpers now route through them).

### Changed
- **Crashed-check cards print their own error (#720).** The generic "could not be verified" card means the check itself failed to produce evidence — it now embeds the underlying error (bounded) in the card copy, and its instructions reference only what is actually on screen. When check output fails contract validation, the exact failing field paths surface on the card, in the server log, and in the execution record.
- **Coverage and search cards speak plainly (#720).** "Agent usage coverage is incomplete" states which scan state it is in and what to expect (running → recheck in a minute; not yet run since boot → resolves itself; stale → the scanner may be stuck, report it), with every coverage reason mapped to plain language. The engine-unavailable card's instructions name real commands (`bakin install search`, the antfly log path, `bakin search:reset` as last resort). "Search is disabled" is now classed as a policy choice, so a box that turned Search off on purpose calms to advisory under standard sensitivity instead of glowing red forever.

### Fixed
- **Overlong copy no longer destroys check evidence (#720).** The root cause of the field-reported generic Verify cards: checks that interpolated dynamic text (a ~700-character runtime gateway error, unbounded model ids) into bounded contract fields failed validation *wholesale* — real evidence became a useless "could not be verified" card. The observation builders now clamp summary, detail, and incident impact to contract bounds (trim, blank-detail drop, surrogate-safe truncation), the known offenders (two schedule checks, five team checks) move errors into detail where they belong, and an independent review's reproduction of the same class in the new gap-enumeration code was fixed before ship.
- **Model sha256 verification moved off the check path (#720).** rc.23 hashed pinned model weights (hundreds of MB) on doctor cadence, which blew check timeouts on loaded machines; checks now verify pinned structure only (file names + sizes — the crash-loop class) and hashing runs post-pull at install time.

## [0.0.1-rc.23] - 2026-07-22

A field-hardening patch, same day as rc.22. Recovering a second production machine surfaced fourteen distinct failures across install, model acquisition, health reporting, and recovery tooling — every item in this release (#718) traces to one of them. The theme: when search breaks, Bakin says what is actually wrong and fixes it with one action. **If search is broken on an existing install:** upgrade, run `bakin install search` (a current binary no longer skips service provisioning), and if the engine state itself is suspect, `bakin search:reset` rebuilds it clean in one command.

### Added
- **`bakin search:reset` (#718).** Stop the engine → wipe its derived index data (content and models untouched) → provision → clean start → repair reindex, as one confirmation-gated verb (`POST /api/search/reset`). This exact sequence was assembled by hand across eight separate steps during the field recovery. Refuses in guest mode — a non-default engine URL belongs to someone else.
- **Pinned model distributions (#718).** The adapter now pins the exact per-model file set verified against the pinned engine (with sha256 from the known-good install). The field failure: `antfly inference pull` served a wrong distribution — ONNX where the engine's Metal runtime needs the paired GGUFs — and the old any-weight-file check passed it while the engine crash-looped 161 times on MissingWeight. Missing pinned files now fail the check BY NAME; hash drift is reported without blocking; unpinned (operator-configured) models keep the generic check.
- **Preload pre-check (#718).** The engine exits outright on a `--preload-model` it cannot load, and the supervisor's respawn turns one broken model into an invisible crash loop. Models failing the distribution check are left off the service argv: the engine boots, that leg degrades honestly, and the models health check names the broken model.
- **Dead-shard watchdog (#718).** An engine can be partially sick — some tables' shard actors dead (status reads 404, queries hang) while every other table progresses, which evades the heartbeat wedge watchdog entirely. The migration pump now probes listed-but-unreadable active tables each tick and bounces the engine (debounced, attempt-capped; the doctor owns escalation). This was the final failure on the recovered box: 2 of 12 tables dark inside a "healthy" engine.
- **Async reindex (#718).** `POST /api/reindex?async=1` returns a 202 job handle; `GET /api/reindex/status` reports progress; `bakin reindex` polls with elapsed-time narration. The old sync-only shape held the HTTP socket across the whole multi-minute blue/green pass with no timeout and no progress — a long rebuild was indistinguishable from a hang. Old servers ignore the flag and answer sync; the CLI handles both.

### Changed
- **"Disabled" and "unreachable" are different states (#718).** `getSearchHealth` used to report `enabled: false` with zero tables whenever the engine was down — telling an operator with a crash-looping engine that search wasn't even configured. The snapshot now carries `engineReachable` (SDK: `SearchHealthSnapshot`), keeps registry tables listed from local state while the engine is down, and every surface renders the difference: CLI header (`enabled — engine UNREACHABLE`), the stats report, the Health system tab (with reindex disabled until the engine answers), and the doctor's index observations.
- **"Missing" and "unreadable" are different diagnoses (#718).** The consistency check treated any null stats read as "Active Search index is missing" → blue/green rebuild. A dead shard inside a live engine 404s the status path while `tables.list` still names the table — and the right fix is a 20-second engine restart, not a GPU-hours rebuild. The check now corroborates against the engine's table list: confirmed-missing → rebuild repair; listed-but-unreadable → a new engine-restart repair; list unavailable → honest unknown (ambiguity never resolves to a rebuild). The adapter client enforces the same discipline: only the engine's own 404 reads as "gone"; every other rejection surfaces as its real error.
- **Disabled embedders degrade to keyword-only (#718).** A disabled/unusable embedder used to flow into table creates as a dimension-0 vector spec the engine 500s on — bricking every media-capable table on the box. Legs whose embedder is off are now skipped (keyword-only table), adapter `capabilities()` stops advertising the leg, and a doctor advisory names the content types serving degraded results so the trade-off is visible, not silent.
- **The "Verify" dead-ends got documented resolutions (#718).** "Spend evidence is incomplete" now walks through completing it (cache model pricing via the Models page — unpriced models are the usual gap on a fresh install; read the named gaps via `bakin spend`; fail-closed deferral is by design). The generic "could not be verified" card now says plainly that the check itself crashed, points at the captured error in its own detail, and gives the diagnose→fix→report path.

### Fixed
- **A noop install still provisions and starts the engine service (#717, folded into #718).** `bakin install search` with a current binary previously did nothing — a box with a wiped or missing service unit stayed dark forever with no path back short of manual launchctl surgery. The noop path now re-provisions the unit and starts the service if it isn't answering.
- **`bakin search:stats` TTY view rendered fiction (#718).** The ink renderer read fields that never existed on the route and printed `-` names and `?` doc counts for perfectly healthy tables — while the piped plain view told the truth. It now renders the real snapshot (per-table docs, backlog split into queued/embedding, migration phase, journal summary) and shows engine-unreachable as its own state.
- **Test runs can no longer touch the machine-global engine service (#718).** While validating this release, the test suite rewrote the real `io.bakin.antfly` LaunchAgent to point at a test temp dir and bounced production search — the second incident of this class. `detectServiceMode` now refuses `launchd`/`systemd` under `NODE_ENV=test` (explicit override still available), so a missed mock in any future test physically cannot reach the real unit.

## [0.0.1-rc.22] - 2026-07-22

A search-reliability release, one day after rc.21. A production incident during an attempted antfly rc.21 engine upgrade turned into a full audit of the search migration machinery — five blind design reviews, a minimal-reproduction ladder against the engine, and a rebuilt migration core. The engine stays pinned at antfly rc.18 (rc.19–rc.21 fail evaluation with a crash dossier, filed upstream); everything Bakin-side is substantially hardened. If search on an rc.21 install shows "degraded", upgrade to this release, then clean-slate the engine (`bakin install search` after removing `~/.bakin/antfly`) and run `bakin reindex`.

### Added
- **Search migration engine v2 (#714).** The blue/green migration core rebuilt around the failure modes a real incident exposed:
  - **Persisted migration identity.** The green's target fingerprint is recorded (`migrating_fp`, search.db v4) and resume replays it verbatim — the old recompute path lost rebuild nonces, could alias the live table, and the post-flip drop would have deleted it (found by review, confirmed in code, guarded by invariants: a migration target equal to the active physical is repaired, never staged, never dropped).
  - **Progress-aware convergence.** A frozen green (doc/indexed/pending counts all static) parks in ~60 seconds instead of holding a flat 10-minute timeout; a leg in error state parks immediately; a still-progressing green gets up to 30 minutes; a failed stats read is never treated as flip evidence.
  - **Backfill-only serialization.** The process-wide chain now bounds only the embed-heavy backfill; converge-waits run per-table off-chain — three stuck tables once serialized into a ~30-minute global stall.
  - **Migration pump.** Parked migrations self-heal on a 5-minute tick (attempt-capped; the doctor owns escalation). Active tables whose physical vanished engine-side (data-dir wipe) are regenerated — judged from one authoritative table listing, never from per-table status errors, and skipped inside a post-restart grace window (a status-error misread once mass-regenerated 10 healthy tables in a feedback loop).
  - **Dominance flip.** An unconverged green whose corpus landed fully now flips over an EMPTY old physical — parking used to leave queries serving zero docs while a complete table sat unflipped.
  - **Surgical reindex.** `bakin reindex` / `POST /api/reindex` is repair-by-default: resume parked, regenerate engine-missing, migrate drifted, skip healthy. `--force` (`?force=1`) restores fresh-generations-for-everything. Overlapping passes single-flight — stacked passes once rebuilt one healthy table through 8 generations in an evening. Rebuilds run in product-priority order (assets first, memory last) at bounded concurrency.
  - **Engine wedge watchdog.** A progress heartbeat (backfill chunks, converge movement, outbox drains) feeds a 30-second watchdog while migrations are in flight; a stale heartbeat bounces the engine via the adapter's own supervised restart instead of waiting on the doctor's 30-minute cadence.
- **Cold drops (#715).** Every engine-side table drop is tombstone-first; the actual DELETE runs only in the doctor's sweep after a 30-minute cold dwell. Defends against antfly#386 (dropping a table with a hot embedding queue crashes affected engine versions — a regression since rc.18 still present upstream): the ladder gate protects Bakin's pin choices, cold drops protect end users from the regressions nobody tested for.

### Changed
- **Antfly stays pinned at 0.2.0-rc.18 (#712 evaluated, reverted in #714).** rc.21 was adopted, battle-tested, and rejected the same day on shell-only reproductions: concurrent embed-bearing writes crash the engine (Metal command-buffer failure, process exit), it exits mid table-creation on an empty data dir, sustained embed load sickens its data plane, and the in-place upgrade migrates table files one-way (a rollback then finds `InvalidTableFile`). Findings filed upstream (antfly #382, #383, #384, #386) with scripted repros; the pin comment documents the re-evaluation recipe for the next release. `bakin install search` now re-provisions the OS service unit unconditionally and treats an engine version change as a rebuild event (derived data dir cleared; the repair reindex regenerates).
- **All engine writes are serialized (#714)** — one write in flight process-wide, matching the engine's demonstrated concurrency contract. Reads are unaffected; rebuild passes stay pipelined.
- **Table identity is the base fingerprint (#714).** Plain ensures no longer treat a nonce'd rebuild generation as drift and migrate it back to the base name — the "boomerang" that re-ran enumerators and re-embedded healthy tables after every rebuild.

### Fixed
- **The search query fan-out shares one wall-clock budget (#714).** Sequential rerank fan-outs gave each of 12 tables its own budget slice (32-second spinners under rebuild load) and the scan fallback's HTTP request ignored the deadline entirely (default 30s timeout after the budget was already spent). Tables past the shared deadline are honestly omitted.
- **The antfly idle-detection override is restored and re-scoped (#713).** Upstream's #319 fix covers media templates but skip-heavy text corpora can still report building-forever while idle; retiring the override had parked every such table. Its companion test is now a guard on the mapping plus raw-flag evidence logging.
- **Gallery test de-flaked for release builds (#711)** — the brand-header assertions survive long describe-stamped versions.

## [0.0.1-rc.21] - 2026-07-21

The largest release to date: ~90 PRs over four weeks. Bakin becomes genuinely multi-runtime — the new Pi adapter runs the full product alongside OpenClaw behind a capability-declared runtime contract with a first-class, carry-everything switch. Around that core: the search stack rebuilt on a durable outbox + blue/green tables, a Chat plugin and ONE conversation engine for every chat surface, cost control v2 with work-class model routing and honest usage attribution, the Brands plugin, team-aware task assignment, the #191 schedule initiative, a client-routing overhaul, and same-agent concurrency.

### Added
- **Pi runtime adapter (#619, #624).** A second runtime implementation: Pi runs in-process via SDK (vs OpenClaw's gateway/MCP), selected by `settings.runtime.adapter`. The full Bakin surface — dispatch, workflows, images, memory, health — works on either runtime.
- **Runtime Capability Foundation (#630).** Every adapter declares a `CapabilitySet` (tool calling, delivery, image gen, memory, sessions, workspace files — native/shimmed/unavailable) plus `describeToolAccess()`; `channels`/`cron` became optional members consumers feature-detect. One renderer feeds dispatch prompts and the AGENTS.md tool-access section. A **runtime conformance suite (#644)** is the acceptance gate for any adapter — shared behavioral checks run against the dev mock, Pi, and the OpenClaw mock, with a teeth file proving the checks bite.
- **First-class runtime switch with carry-over (#657).** `bakin runtime use <adapter>` orchestrates backup → flip → provision → roster reconcile (model + subagent-model mapping with an honest unmapped report) → workspace content carry (soul/memory verbatim, agent-authored skills) → drift-gated sync, ending in a capability + can't-carry + credential report. `--dry-run` previews the whole thing with zero writes.
- **Pi parity program (P1–P5).** **Integration secrets (#662):** named secrets in `~/.bakin/secrets.json`, masked `/api/secrets`, Settings → Integrations & Keys, env-first injection at server boot. **Capability packs (#664, #674, #675):** skill-packs that grant per-turn powers (web search, …) with pinned sha256 binaries, npm payloads, model prereqs, and enforced secret slots — one readiness engine behind the REST surface, doctor findings, CLI, and hub; plus three fast-follow packs. **Task-completion tail (#666):** approval attention, model preservation, cron adoption. **Runtime hub (#667, #672, #673):** the `/runtime` page rebuilt as a tabbed hub on the SDK kit with one-click Fix for setup checks. **Pi-native image completion (#676)** with keyed-lane edit + multi-reference parity, and a **Pi extension trust lane (#677)** — third-party extension code requires approval before it runs.
- **Search & asset rebuild (#457).** Antfly v0.2 (Zig), pinned + SHA256-verified, running as an OS-supervised service (launchd/systemd user unit). Writes journal through a durable SQLite outbox and land via a drain pump — engine down means rows wait, never lost. Tables are blue/green versioned: schema/model changes migrate in the background with queries pinned to the old table until convergence; boot performs zero engine calls when state matches. Plus zero-config asset enrichment.
- **Search trust & speed (#651, #653).** Engine pinned to rc.18; every request runs under a query budget (default 2s) with per-table cooperative deadlines and honest degradation to keyword-only or omission (`meta.partial`/`meta.tables[]`) — never a silent stall. Health surfaces carry per-table freshness + numeric backlog, and a `search-spin` watchdog catches zero-progress backfills with a one-click blue/green rebuild repair. Cold-boot search readiness went 28.8s → 1.0s.
- **Chat plugin (#622, #660).** Streamed multi-chat with any agent: schema-v2 transcripts, one in-flight turn per chat with abort, image attachments, budget-gated auto-titles, unread/attention (nav badge + tab-title prefix + toast/chime/OS notification), and transcripts in global search. The client side shipped as a reusable **SDK conversation kit** — turn folding, bus-driven threads, attention rules, renderers, composer.
- **Shared conversation turn engine (#703: PRs #704, #705).** ONE server-side turn engine (`createConversationTurnService`) behind every chat-like surface: background turns detached from HTTP (202 on send, 409 busy), incremental persistence, abort → clean done. Chat and brands consume it; external plugins get it via `ctx.conversations` with declarative metering.
- **Cost control v2 (#628).** Budget policy as a rule list — global/agent/provider scopes × billing lanes, with unit-per-lane (metered rules cap USD, subscription rules cap tokens). Breaches open durable ledger-backed incidents that notify and resolve via raise/ack/resume; a dispatch kill switch; budget-deferred tasks badged on the board; fresh installs are never silently uncapped.
- **Work-class model routing (#696).** ONE routing + spend-attribution key: every LLM-consuming call site is a `WorkClass`, routes (class → model/thinking) + tag overrides live in models settings, and every metered turn writes a route receipt — the dimension that routes IS the dimension spend reports on (Spend tab, `bakin spend`, Team Diagnostics). A `models.routing` health check flags unrouted classes/unavailable routes/standing clamps with a one-click apply-recommended-routes repair. Heartbeats are zero-token on both runtimes.
- **Usage attribution & health sensitivity (#698).** usage.db rows carry adapter-labeled session origin, so non-task usage splits into `interactive` (advisory) vs `unexplained` (watch) vs `runaway` (action_required, with a cron-jobs downgrade guard) — NULL-honest, day-aligned. Doctor incidents gained a 10-value `class` enum projected through a sensitivity policy (`developer|standard|quiet`) — calm the noise without hiding action-required findings. Plus **durable usage history (#599)**: per-(session, day, model) rollups in usage.db, beyond the latest session.
- **Brands plugin (#629, #631, #663).** Brand records under `~/.bakin/brands/` (zod manifest for machines, markdown for agents); tasks carry `brandId` with lazy ancestry/project resolution at dispatch and a byte-budgeted two-tier brand card injected into prompts; image tools take `brandId` (palette merge, default references, provenance). Draft lifecycle: questionnaire or website mode → agent authors via draft-gated tools → publish. Portable repo import/export, dedicated doc editor, server-computed kit completeness, and a top-to-bottom UX pass.
- **Team-aware task assignment (#612, #697).** Tasks can be assigned to a team: dispatch resolves the best-suited member pre-claim via an LLM-routed hook riding the runtime's own transport (no API keys), sticky once resolved, with structural failures blocking honestly. Workflow steps target teams the same way via `team:<id>` tokens (#611), sticky per step.
- **Agent health diagnostics (#613, #616).** The supervision layer: sync drift, context budget, burn/spike heuristics, and a per-agent activity timeline (run spine + audit interleave). Surfaces: Health incidents with structured resources + bounded evidence, Team Diagnostics, `bakin agents doctor <id>`, and a hand-rolled SDK chart kit. **Health itself was redesigned as an action-first observability dashboard (#684).**
- **Schedule initiative #191 (#681–#685).** Foundation hardening; first-class one-shot "at" schedules; server-computed occurrences feeding the calendars; and **plugin-contributed scheduled domain events** — any plugin can put its dates (publish dates, deadlines) on the Schedule calendars via a `{pluginId}.scheduledEvents` hook, with per-provider budgets and `droppedProviders` honesty. Tasks is the in-tree provider (`availableAt`/`dueAt`, reschedulable).
- **Same-agent concurrency (#447, #699).** Per-agent parallelism is capability-gated: isolated on Pi via per-run workspace dirs under `~/.bakin/run-workspaces/` (sidecar-classified, watchdog-swept, size-budgeted); serialized on OpenClaw (clamped to 1 with an audit receipt). Repo-bound tasks get a git worktree per run — the branch is the deliverable.
- **Explore storefront (#610, #586, #585).** The `explore` plugin is the discovery storefront at `/explore` — one curated catalog drives both onboarding recommendations and browse+install. H'enrich joined the catalog default-selected, and agent packages can now seed a team persona.
- **Workflow map fan-out + Multi-Image Select (#203, #623, #598).** `map_workflow` steps fan a nested workflow out over a list; the images plugin gained multi-image selection.
- **Gate approvals & Discord notifications (#607).** End-to-end validated and hardened, with threaded gate UX.
- **True streaming + live dispatch activity (#632, #633).** The OpenClaw adapter streams via gateway push events; dispatch surfaces live turn activity with trajectory-tail deletion.
- **Startup context diagnostics (#357, #589).** Per-source measurement + bounds on what a fresh dispatch session costs: one engine behind `bakin agents context`, `GET /api/context-report`, and a warn-only doctor check; workflow prior-step dumps are byte-budgeted with visible omission markers; static boilerplate pinned by byte fixtures.
- **SDK: testing harness, golden path, tightened types (#635, #636, #642).** A published `@makinbakin/sdk/testing` entry with an isolated per-test harness, a plugin scaffold + semver gate + sync-manifest for external authors, `TurnOutputView`, and a reference plugin.
- **Dual-runtime dev rig (#652).** `bun run instance` runs a real runtime against dev-scoped state on either adapter — OpenClaw in Docker, Pi in-process with a throwaway `PI_HOME` — with asset-save parity and isolated per-instance search.

### Changed
- **Main navigation reorganized (#694)** and the client made a real SPA (#692, #693, #695): internal navigation never full-reloads (architecture-test enforced), chat moved to path routes (`/chat/$chatId`), query params became plain strings with per-tick setter batching, element-level scroll restoration is on, and unknown paths render a real 404 page. Presentation-based taxonomy: path = page identity, query = overlays/tabs/filters.
- **Audit follow-up workstreams FW1–FW8 (#587, #588, #591, #592, #594, #596).** Guards & correctness; the stalled CLI consolidation finished (`bakin.ts` 4,413 → 209 lines, one lazy module per command group); the plugin boundary made real (registries moved to core, one sanctioned crossing, guards); the four UI god-files and the server god-files (models/assets indexes, install phases, upgrade lanes) decomposed; dedup remainder, test god-files, and a docs sweep.
- **Workflows: dead YAML surface deleted (#600) — breaking** for workflow authors using `dependsOn`, `on_approve`, or passthrough schemas; cross-plugin nested refs became order-independent (#595).
- **Legacy per-request conversation streaming deleted (#705) — breaking** for plugin authors on the old SDK stream surface; everything rides the shared SSE bus + conversation kit now.
- **Parallel test workers (#634, #638, #640, #700).** CI's test step went ~9.4min → ~2min, with parallel-safe React component tests, per-test RTL cleanup under bun:test, and the kanban-dnd suite un-quarantined.
- **Task delete aborts its in-flight agent turn (#604, #609)** — an `AbortController` per registry entry settles the turn clean, and the watchdog sweeps orphaned turns whose task is gone.
- Removed the orphaned validate-package script (#602); general cleanup sweep — rig off mcporter, doc drift, SDK primitive adoption (#643).

### Fixed
- **Search:** every global-search hit navigates to its exact record (#593); wedged-engine incidents are prevented, detected, and auto-repaired, and orphaned blue/green tables are swept (#659); degraded multiQuery logs one aggregated warn instead of one per table (#661).
- **Doctor/health:** the SendFailed wedge variant is caught and stale/archived escalation covers un-muted (#680); audit-feed noise from missing manifest permissions and empty-agent capability probes silenced (#679).
- **Plugins/host:** plugin boot is bounded — no more infinite "Loading plugins" (#654); hot reload re-registers declarative routes (#649); honest build output for server-only plugins (#655); package-update probes are async so the Team page can't freeze the server (#656); brands declares the capability permissions it uses (#631).
- **OpenClaw adapter:** bakin MCP servers scoped per agent (#639); sessionless MCP GETs answer 405 instead of stalling codex clients 5s (#641); server-side abort works for threaded turns (#637).
- **Workflows:** `$preferred` selectors resolve on fan-out board tasks (#658).
- **Dispatch/tests:** a dispatch-concurrency contention wedge + mock-checker false positives (#701); rig OpenClaw image tag pinned + effort Done-column clarity (#616).
- **Audit sweeps:** 8 bugs from the rig audit + Imitation Crab demo seeds (#603); lint backlog, schedule resilience, orphan cleanup, policy table (#605); credential merge + kanban flake follow-ups (#678).
- **Notifications:** toast content can't paint past the toast box, closed nav groups roll hidden child badges up to the header, and conversations show the working dot instantly at turn-accept (#707).
- Team avatar 304 declaration + pending-search empty state (#590).

## [0.0.1-rc.20] - 2026-06-24

A hotfix for rc.19: the production binary shipped a stale embedded-asset manifest, so vendor-chunk imports 404'd and every SDK-hooks-consuming plugin failed to load.

### Fixed
- **Stale embedded-asset manifest in release builds (#579).** `_embedded-assets-static.ts` lists which content-hashed vendor bundles get compiled into the binary, but only `bun run dev` regenerated it — `bun run build` and `release.yml` never did. So the resize work in #577 changed the SDK shared-chunk hashes while rc.19 embedded the old set, 404'ing `sdk-hooks.js`'s chunk imports in the binary (`module '@makinbakin/sdk/hooks' does not provide an export named 'usePluginEvent'`). The manifest is regenerated, and `build:assets-manifest` is now part of the `build` chain and `release.yml` (after host-shell, before assert + binary) so it can't go stale in a release again.

## [0.0.1-rc.19] - 2026-06-24

This is primarily an architecture release: ~380 commits, the bulk of them a behavior-preserving, codebase-wide module-splitting refactor (the "great refactor"). Alongside it ship metered spend + budgets, layered team context, reference images, and a batch of audit-driven fixes.

### Added
- **Metered spend and budgets.** Per-run cost is now recorded on settle and fed into the single usage recorder; image generation is metered as a spend event. A budget policy + evaluator (window boundaries, warn → defer-with-audit, fail-closed) gates dispatch, with a budget config UI and a spend-vs-budget health check. The health dashboard splits its cost cards into **usage** vs **spend** and adds full-width Context Usage; the models page gains a **Spend** view (`/spend` route) and a routing config UI (origins + tag overrides).
- **Layered team context + agent-sync UI (#401).** Team context is composed from layers — `global.md` (all agents) + role layer (`orchestrator`/`subagent`) + per-team file — projected through `bakin agents sync`. New team detail pages, a global pseudo-team, graph badges, and a health-repair path surface and drive sync from the UI.
- **Reference / context images for image generation (#418, #379, #380).** `generate` and `edit` accept reference/context images; runtime `media://` URIs resolve as references; attachments auto-import (tagged) into the asset store; iteration lands as a new **version** rather than a sibling asset. Channel delivery is deduped — an asset is delivered to a channel once per task, and oversized images are delivered as derived exports instead of duplicates.
- **Real task-outcome run history (#481).** The task run history reflects the actual task outcome (block / reopen / archive), not just the last dispatch outcome, with pre-ledger completions backfilled.
- **Dual-format avatar support (#339)** — WebP / PNG / JPEG agent avatars.
- **Session-store retention health check (#435).**
- **SDK client primitives.** `usePluginEvent` collapses every plugin onto one shared shell SSE connection; plus `useJsonFetch`, `useAvailableModels`, `useHorizontalResize` (+ a shared resizable-pane core), `ConfirmDialog`, `EmptyState`, formatters, and `toneBadge` for outline status badges.

### Changed
- **Codebase-wide module split (behavior-preserving).** The core monoliths were decomposed into focused, single-responsibility modules with thin barrels, run as parallel workstreams (WS2 core extractions + dependency-cycle break, WS3 SDK primitives, WS4 CLI, WS5 search) plus phased per-subsystem splits. Highlights: `runtime.ts` 3,188 → 1,560 lines across 10 PRs; `server.ts` split into a request-handler router, search-startup, startup-recovery, and Web-handler migrations; the OpenClaw adapter broken into ~10 helper modules (agent-turn, channels, config, session-activity, approvals, image-inference, cron-store, errors); the schedule plugin split across 7 phases (util → context → fire-engine → loop → job-service → exec-tools → routes); workflows split into runtime seams, routes, exec-tools, and hooks; `asset-service` reduced to a barrel over `asset-core` / `asset-mutations` / `asset-upsert` / `asset-media` / `asset-trash`; the docs-generate pipeline, models page, canvas editor, and the health / team / tasks plugins all thinned the same way; `plugin-registry` moved `src/lib` → `src/core`; the CLI gained a readonly split + shared HTTP client.
- **SDK vendor bundles consolidated via code splitting (#422)**, plus a binary-size audit with `size:report` tooling, dependency hygiene, and a decision doc (#424).
- **Subagent role defaults** gained an invoker-reporting rule, and agent content was put on a diet to trim dispatch-prompt weight.
- **Asset duplicates are now structurally impossible** — store-path reflection + same-task content dedupe replace after-the-fact cleanup.
- Deleted the dead legacy OpenAPI generator (−227 lines).

### Fixed
- **Security audit** — path-traversal, secret-handling, and supply-chain findings closed (#497); a full-system audit swept incidental correctness bugs — dev images watcher, a dead server write, schedule pause drift (#505).
- Workflows: nested workflows are cycle-detected on the REST start path so a cyclic graph can't be started.
- Schedule: a blocked task no longer suppresses that schedule's fire (#479).
- Tasks: the completion-row invariant holds across block / reopen paths, which could previously strand the row (#485).
- Search: multi-content plugins route by a primary table instead of writing to the wrong one.
- Dev loop: signal handlers no longer preempt lifecycle shutdown (#459); the pinned local Tailwind binary is spawned directly instead of `bunx @latest`; the images plugin is now watched.
- Team: client-side routing + page polish so navigation doesn't full-reload.
- CLI: sync-migration prompt handles a 409, and the agent-sync check runs off-server.
- Health/workflows: plugin-assets init and the skill check both work off-server / registry-aware.
- Core: the bare core exec-tool context is granted full permissions.
- Dockerized rig: cron-CLI operator scopes + a stale host `agentDir` on reused state (#487).
- Manual-test batch (#577): dev start, team sync UX, resizable split panes, and channel delivery + permissions.

## [0.0.1-rc.18] - 2026-06-08

### Added
- **Bakin-owned scheduler — ends the scheduled-task double-fire.** Bakin now owns the firing of its own schedules instead of delegating to OpenClaw cron (which used to fire a rogue agent turn *and* a Bakin task for the same job). A dependency-injected, fake-clock-testable tick computes due occurrences, claims a deterministic per-occurrence run id in the execution ledger (exactly-once via the `(job_id, run_id)` key), and creates the task directly. Startup catch-up coalesces a downtime gap to the single most-recent missed occurrence and lands it in **Todo** within a configurable safety window or **Blocked** when stale. An idempotent cutover migrates existing schedules off OpenClaw cron automatically on startup, with `bakin doctor --full` to verify (the `schedule-cutover` check) and `bakin doctor --fix` to complete it if the runtime was unreachable at boot.
- Native (runtime-owned) crons are surfaced **read-only** with adopt / restore-native actions, a next-run column, and 403/404 mutation guards — Bakin owns Bakin schedules; the runtime owns the crons agents create for themselves.
- A prompt **danger-zone guard** that warns when a schedule prompt tells the agent to keep one large message and not split near the channel transport limit (the shape that caused the "Invalid Form Body" split/repair loop).
- **Schedule run visibility.** Each schedule's job drawer now shows a real run history read from the execution ledger (`cron_fires`) — fired / skipped / blocked per occurrence — replacing the post-cutover-empty runtime-cron history. Skipped fires (overlap / paused / skip-count / auto-paused) emit a `schedule.fire_skipped` activity-audit event and persist their reason (new `cron_fires.skip_reason` column) instead of silently dropping beats.
- **Per-task run history.** The task detail drawer gains a collapsible **Run History** section listing every dispatch attempt for the task (seq, agent, time, status — settled / superseded / lost — settle reason, duration) from the `runs` ledger, via `GET /api/plugins/tasks/:taskId/runs` and a `listRunsByTask` read verb.

### Changed
- The scheduling of Bakin tasks is now Bakin-owned end to end; OpenClaw cron is no longer involved in firing them. Removed the cron→task bridge webhook + shared secret, the reconcile-poll, the legacy main-session-wake repair cluster, the sidecar `processedRunIds` seeding, and the adapter's Bakin-specific cron payload shaping (~500 lines of wrangling).
- Mock (`dev:mock`) seeds Bakin schedules, `cron_fires`, and `runs` history so the new run-history surfaces are exercisable; native-cron fixtures trimmed so the list isn't a wall of "missing cron tools" warnings.

### Fixed
- The 9am scheduled-task double-post (one cron fire → two executions → duplicate Discord post + delivery-repair loop) — eliminated structurally by the Bakin-owned scheduler.
- Schedule fire no longer duplicates a task when a post-create effect fails after the task row is written — the existing task is attached to the claim instead of left for the healer to re-create (#472).
- A timed pause whose window elapsed no longer leaves a schedule permanently disabled; a newly created schedule no longer phantom-fires its pre-creation occurrence on the first tick.
- The schedule list-row actions menu sizes to its content instead of clipping / wrapping "Adopt into Bakin".

## [0.0.1-rc.17] - 2026-06-06

### Added
- **Execution safety ledger — exactly-once task firing and completion.** A SQLite coordination ledger at `~/.bakin/bakin.db` (WAL) where UNIQUE constraints are the locks: cron fires are claimed before task creation, every dispatch path claims its run before sending (the ledger mints the dispatch sequence), completions are first-write-wins (retries report `alreadyComplete` instead of erroring), and billed image results are durable idempotency rows with no TTL so client-timeout retries cannot double-bill. Duplicates are suppressed and audited; a ledger that cannot be opened fails closed.
- Server singleton lock (`~/.bakin/server.lock`) taken before any side effect, with graceful shutdown on `EADDRINUSE` so a second instance can never double-fire scheduled work.
- An `execution-safety` doctor check surfacing suppressed duplicates, claim leaks, and ledger health.
- Optimistic task versioning with freeze-on-complete edit safety, so concurrent edits cannot silently clobber a task that has finished.
- **Asset tags and folders.** Tags are now first-class asset-level metadata (decoupled from the version mirror) with normalization, a metadata edit drawer with tag input, bulk multi-select tagging, global tag rename/remove and bulk-apply APIs, a tags facet filter, and a folders view that groups assets by tag with breadcrumb navigation and URL-backed state. Generation provenance is indexed for search, and the asset grid uses a content-driven tile layout.
- **Lazy plugin loading.** Plugin manifests can declare `contributes.nav/routes/slots/eager`; the host boots navigation from the manifest and lazy-loads noncritical plugin clients on demand instead of importing every plugin at startup.
- Whiskit shared build backend: user-plugin builds run on the system Bun through one hardened runner, `bakin plugins publish` gains `--build`, plugin `check`/`upgrade` route through the Whiskit artifact lane, and dev hot-reload surfaces Whiskit rebuild diagnostics.

### Changed
- Dispatch I/O efficiency pass: an in-memory task-store index (id→path + column buckets, self-healing), a single SSE broadcast per task write, an mtime-validated asset manifest cache behind asset-service reads with debounced grid refetch, a lesson-retrieval cache, reverse tail reads for audit time-window queries, incremental trajectory forensics scans, an LRU cap on the session store cache, and dispatch threadId sequence mints folded into one persist-before-send state save.
- Dispatch prompts slimmed: the static tool catalog moved out of every dispatch prompt into a managed execution-tools block in agent workspaces (`bakin agent-rules --apply-all` covers subagent blocks).
- Core plugin builds skip the server entry; release binaries embed only browser assets (`client.js`/`client.css`) and the server refuses to serve plugin server bundles over HTTP. Whiskit publish fails server builds that retain host-provided browser externals.
- Watchdog recovery is supersede-first and uses ledger heartbeats for liveness instead of racing the original turn.
- Shell bundle moved to `/_app/*` so client routes like `/assets` survive a hard refresh.

### Fixed
- Deterministic Discord digest delivery.
- Completion retries on an already-done task no longer trip the task store's transition guard.
- Watchdog respects a manual restart-recovery classification instead of re-diagnosing the turn.
- Silent lesson drops: lesson retrieval now carries an omission marker when lessons are truncated.
- `assets.listByTask` hook backed by a taskId index, repairing the broken asset block in dispatch prompts.
- SDK root barrel is server-safe — the slots registry split from the `<Slot>` rendering layer so server code can import the barrel without pulling in React DOM.

## [0.0.1-rc.16] - 2026-06-05

### Added
- **Whiskit plugin artifacts — toolchain-free plugin installs.** `bakin plugins publish` assembles a plugin into a versioned, prebuilt `.tar.gz` artifact (manifest + `dist/` + build provenance) with a SHA256 checksum and a carry-forward `whiskit-artifacts.json` release catalog. Installing a GitHub plugin now downloads and verifies that prebuilt artifact and extracts it into the content directory — nothing builds on the user's machine.
- GitHub-release artifact resolver, consumer materialization, and live install into the content directory with a lockfile entry; safe extraction rejects symlinks, zip-slip paths, and oversized archives.
- Startup verification of installed plugin artifacts against the host externals contract, plus a doctor/health check that flags installed plugin artifacts which are outdated or invalid and need a rebuild.
- Shared install core unifying the plugin and agent-package install paths: one subpath guard, atomic JSON lockfile writes, an advisory install lock, and a staging→commit transaction.
- **Session-death recovery ladder.** Diagnosed agent-session deaths now salvage partial output as an asset and escalate through corrective re-dispatch, decomposition into subtasks, and a diagnostic block instead of blind retries — backed by a read-only OpenClaw trajectory forensics parser, fail-fast detection of session deaths during pending turns, a session-death health check, and audit query helpers.
- **Concurrent dispatch.** An in-flight turn registry with per-agent and global concurrency caps (`maxConcurrentTurns` / `maxTurnsPerAgent`), settle-time reconciliation, and per-dispatch provider sessions with stable idempotency keys.
- Output-discipline prompt rules (deliverables to files + `bakin_exec_assets_save`, one at a time, terse chat), a runtime-derived agent roster, and shared tool documentation carried on dispatch prompts.
- A dockerized rig validation campaign with functional end-to-end coverage and benchmarks against a real OpenClaw instance.

### Changed
- Classify dispatch and runtime failures by a typed `kind` rather than error-message text, and treat task continuation as a full re-dispatch against a fresh per-attempt provider session.
- Exclude `node_modules` from published plugin artifacts (pure-JS plugins, v1).

### Fixed
- Add a request timeout to artifact downloads so a stalled release host cannot hang an install.
- Treat a `dependsOn` pointer to a hard-deleted task as satisfied, preventing dependent tasks from being stranded.
- Abort the session-activity poller when a chat-stream consumer breaks early.
- Close three recovery-flow gaps plus idle-determinism and recovery-completeness issues surfaced by the live rig ladder smoke and code review.

## [0.0.1-rc.15] - 2026-06-04

### Fixed
- Add a production JSX dev-runtime compatibility shim so stale installed plugin client bundles that still call `jsxDEV(...)` load instead of crashing after the production asset build change.

## [0.0.1-rc.14] - 2026-06-04

### Fixed
- Build release plugin client bundles with the production JSX runtime so packaged core plugins do not import `react/jsx-dev-runtime`.
- Rebuild stale installed-plugin `dist/client.js` bundles that still contain JSX dev-runtime output, even when existing GitHub-installed plugin artifacts would otherwise be trusted.

## [0.0.1-rc.13] - 2026-06-04

### Added
- Add compressed release archive packaging for platform binaries, including tar.gz generation/extraction helpers, archive checksum publishing, and post-publish smoke coverage for archive downloads.

### Changed
- Ship GitHub release binaries, installer downloads, Homebrew formula output, and self-update downloads as `bakin-<platform>-<arch>.tar.gz` archives instead of raw executable assets.
- Minify production browser, plugin, and vendor assets during release builds, with an assertion step that fails CI when unminified production assets are emitted.
- Document compressed release artifacts across install, operations, Homebrew, security, release-pipeline, and architecture notes.

### Fixed
- Prevent versioned asset delete requests from hanging by treating delete lifecycle routes as writable operations and reflecting deletion progress/error state in the asset detail UI.
- Type self-update platform overrides correctly so archive-based update tests and platform-specific update paths stay aligned.

## [0.0.1-rc.12] - 2026-06-03

### Added
- Add plugin startup diagnostics for boot/build/registration failures, including a `bakin diagnostics plugin-startup` CLI command, persisted diagnostics settings, host API metadata, and UI surfacing in plugin cards.
- Add plugin startup diagnostics documentation and knowledge notes covering the troubleshooting workflow and usage-recording semantics.

### Changed
- Compress startup and static API responses over remote links to reduce payload size during app boot.
- Refresh generated CLI, settings, API, SDK, and core plugin reference docs for the startup diagnostics surfaces.

### Fixed
- Preserve actionable plugin startup errors from manifest loading, user-plugin builds, embedded plugin registration, and runtime startup so plugin boot failures can be diagnosed instead of collapsing into generic load failures.

## [0.0.1-rc.11] - 2026-06-03

### Added
- Add structured dispatch failure details for task handoffs, including provider, model, error code, retryability, suggested next actions, and raw provider response metadata.
- Surface dispatch failure context in task cards, task detail dialogs, activity feeds, SSE activity events, and audit-message mapping so failed handoffs are readable from both task and timeline views.

### Changed
- Update GitHub Actions workflows to the Node 24-based v5 action releases.
- Document provider failure context semantics in dispatch knowledge notes.

### Fixed
- Embed core plugin manifest permissions in the static plugin imports so packaged plugins retain their declared startup permissions outside a source checkout.

## [0.0.1-rc.10] - 2026-06-02

### Added
- Add memory cleanup: find a stale term across runtime memory tiers, dispatch one cleanup task per affected agent (the agent edits its own source), and verify remaining occurrences per agent, with a dedicated find → dispatch → verify UI flow. Cleanup edits to package-projected files are protected so managed content is not overwritten.
- Add update controls and agent cleanup flows to the UI for managing installed plugins and agent packages.
- Add workflow skill drift detection and repair, surfacing stale skills (including those in parallel workflow groups) with an in-place upgrade action.
- Add a dockerized OpenClaw rig (`bun run instance up`/`dev`/`run`/`shell`/`reset`/`down`) for one-command UI + CLI development against a real OpenClaw in Docker without touching `~/.openclaw`, including 1Password-driven secrets, Discord channel wiring, MCP tool bridging via mcporter, and Codex device-code login.

### Changed
- Document the memory cleanup capability and amend the read/dispatch invariant (Bakin never writes runtime-memory content).
- Refine workflow skill drift repair copy and move the stale-skill upgrade action below the skill details.

### Fixed
- Route OpenClaw channel/message delivery through the CLI path so agent messages are delivered reliably.
- Resolve the OpenClaw workspace against the resolved home directory rather than foreign config paths.
- Report managed plugin and agent-package versions from their lockfiles instead of stale or fabricated values.
- Harden image generation retries against provider timeouts while preserving billing idempotency.
- Lazy-load `sharp` in core plugins so release binaries start without eagerly resolving the native module.
- Keep stale workflow node content readable while drift repair is pending.
- Scaffold an empty changelog section during release branch prep instead of blocking the branch when the section is missing.

## [0.0.1-rc.9] - 2026-06-01

### Added
- Add the versioned asset model across storage, HTTP routes, search indexing, lifecycle operations, uploads, trash, relinking, and the asset browser UI, including version timelines, previews, current-version pinning, and empty states.
- Add runtime-routed image generation with the core images plugin, execution tools, workflow defaults, provider routing, provider-key management, and OpenClaw native image support.
- Add SDK and host nav-badge support, including Tasks and Health badge providers and Health doctor-version signaling.
- Add the TypeScript compiler-backed SDK reference generator and refresh generated documentation/reference output.

### Changed
- Cut asset, task-asset, image, clipboard, inbox, health, search, and agent-facing asset flows over to stable asset IDs and retire the legacy filename-based asset UI/routes/surfaces.
- Improve Settings layout, plugin setting grouping, labels, and responsive row behavior.
- Update asset, image, plugin, and release-pipeline docs for the new runtime and release-candidate behavior.

### Fixed
- Prevent schedule cron double execution.
- Gate the release `smoke-sdk` job on the exact SDK version becoming resolvable on npm (bounded exponential backoff via `scripts/wait-for-npm-version.ts`) so it no longer races registry propagation right after publish.
- Bound npm registry checks to the full timeout budget to avoid stuck release gates.
- Harden versioned asset path resolution, filename sanitization, thumbnails, export/range handling, stale grid previews, and search result stability.
- Harden image generation billing/idempotency, provider fallback, credential lookup, generated-dimension recording, and provider settings error reporting.
- Harden provider secret storage with atomic `0600` writes and secret id validation.
- Fix host/sidebar nav-badge rollups, test stability, and onboarding asset plugin isolation.

## [0.0.1-rc.8] - 2026-05-28

### Changed
- Update release-candidate install commands to pin `v0.0.1-rc.8`.

### Fixed
- Remove stale lint violations that blocked release-candidate CI after `v0.0.1-rc.7`.

## [0.0.1-rc.7] - 2026-05-28

### Changed
- Update release-candidate install commands to pin `v0.0.1-rc.7`.

### Fixed
- Repair compiled binary service setup and restart launch paths so macOS LaunchAgents and Linux user services run the real `bakin serve` executable instead of Bun virtual filesystem paths.

## [0.0.1-rc.6] - 2026-05-27

### Added
- Seed imitation-crab with the production five-agent roster, canonical asset fixtures, projects and messaging plugin data, expanded schedule fixtures, and Health usage/session cost data for richer local smoke testing.
- Add workflow editor support for ordered canvas editing, node configuration, add/reorder/delete/copy flows, enable/disable handling, availability tracking, and unsaved-change protection.

### Changed
- Update release-candidate install commands to pin `v0.0.1-rc.6`.
- Keep Health cost reporting tied to runtime-provided values, including nullable unavailable costs and totals derived from runtime cost components.

### Fixed
- Reconcile accepted runtime dispatch failures when app-server idle or runtime errors arrive after handoff, while preserving the existing retry and cooldown path for delivery failures.
- Route OpenClaw schedule cron list/create/update/delete/run-history operations through the CLI/Gateway path, preserve provider-generated ids and timezones, expose full-day calendar coverage, and confirm scheduled job deletes.
- Show current Health search document counts by normalizing adapter document count fields across memory, search, and CLI health surfaces.
- Retry SDK publishes without provenance when npm records a duplicate transparency-log entry before the package version reaches the registry.

## [0.0.1-rc.5] - 2026-05-27

### Changed
- Superseded by `0.0.1-rc.6`; the release workflow created this tag but did not publish public artifacts after npm returned a duplicate transparency-log entry during SDK publish.

## [0.0.1-rc.4] - 2026-05-25

### Fixed
- Embed the Bakin runtime skill template in release binaries so first-time installs can sync the `bakin` skill outside a source checkout.

## [0.0.1-rc.3] - 2026-05-25

### Changed
- Update release-candidate install commands to pin `v0.0.1-rc.3`.

### Fixed
- Fix `bakin update` for prerelease-only release trains by falling back to the newest published release candidate when GitHub has no stable `/latest` release.

## [0.0.1-rc.2] - 2026-05-25

### Added
- Add native OpenClaw MCP registration during onboarding so Bakin tools are available to fresh main-agent sessions.
- Add a Bakin runtime skill during onboarding to explain Bakin task, project, workflow, asset, schedule, and agent coordination.

### Changed
- Make the release-candidate install command explicit in README and install docs while stable Homebrew publishing remains pending.
- Rename the official research agent from `jessica-fetcher` to `jessica` across curated agent data and guidance.

### Fixed
- Preserve the adapter boundary while syncing Bakin MCP server entries through the runtime config interface.
- Improve fresh-machine install guidance for shells that need `~/.local/bin` added to `PATH`.

## [0.0.1-rc.1] - 2026-05-19

### Added
- Prepare the first release-candidate binary and SDK publishing path for fresh-machine install testing.
- Ship the standalone `bakin` CLI and local web app.
- Add core plugins for tasks, team, assets, memory, schedule, workflows, models, health, and git worktrees.
- Add plugin and agent package authoring surfaces.
- Add consistent Ink TUI output across core CLI commands, including onboarding, doctor, list/get surfaces, JSON mode, tables, prompts, logs, and error responses.
- Add doctor repair delegation and verification output for task-board handoff workflows.

### Changed
- Align bundled adapter versions and compatibility ranges with the `0.0.1` release train.
- Start unpublished patch release prep at `v0.0.1-rc.1` instead of `v0.1.0-rc.1`.

### Fixed
- Stamp release versions into binaries so `bakin --version` matches the release tag.
- Sign and notarize macOS release binaries.
- Publish release assets, SDK packages, Homebrew formula updates, and post-publish smoke checks from CI.

[0.0.1-rc.8]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.8
[0.0.1-rc.7]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.7
[0.0.1-rc.6]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.6
[0.0.1-rc.5]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.5
[0.0.1-rc.4]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.4
[0.0.1-rc.3]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.3
[0.0.1-rc.2]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.2
[0.0.1-rc.1]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.1

[0.0.1-rc.9]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.9

[0.0.1-rc.10]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.10

[0.0.1-rc.11]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.11

[0.0.1-rc.12]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.12

[0.0.1-rc.13]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.13

[0.0.1-rc.14]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.14

[0.0.1-rc.15]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.15

[0.0.1-rc.16]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.16

[0.0.1-rc.17]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.17

[0.0.1-rc.18]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.18

[0.0.1-rc.19]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.19

[0.0.1-rc.20]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.20

[0.0.1-rc.21]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.21

[0.0.1-rc.22]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.22

[0.0.1-rc.23]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.23

[0.0.1-rc.24]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.24

[0.0.1-rc.25]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.25

[0.0.1-rc.26]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.26

[0.0.1-rc.27]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.27

[0.0.1-rc.28]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.28

[0.0.1-rc.29]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.29

[0.0.1-rc.30]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.30

[0.0.1-rc.31]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.31

[0.0.1-rc.32]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.32

[0.0.1-rc.33]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.33

[0.0.1-rc.34]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.34

[0.0.1-rc.35]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.35

[0.0.1-rc.36]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.36

[0.0.1-rc.37]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.37

[Unreleased]: https://github.com/markhayden/bakin/compare/v0.0.1-rc.38...HEAD
[0.0.1-rc.38]: https://github.com/markhayden/bakin/releases/tag/v0.0.1-rc.38
