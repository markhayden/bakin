---
title: Package Manifest
description: Package reusable agents, skills, workflows, lessons, workspace files, and assets for Bakin.
---

Agent packages are installable bundles for Bakin and runtime-managed agent state. They use `bakin-package.json`, not `bakin-plugin.json`. The manifest is parsed with a strict Zod schema before install.

The tested manifest fixture for these docs lives at `docs/snippets/agent-package-basic/bakin-package.json`.

<!-- docs:snippet agent-package-basic-manifest -->
Source: `docs/snippets/agent-package-basic/bakin-package.json`

```json
{
  "id": "content-planner",
  "name": "Content Planner",
  "version": "0.1.0",
  "kind": "agent",
  "description": "Minimal agent package used by the public Bakin docs.",
  "bakin": ">=0.1.0",
  "agent": {
    "identity": {
      "name": "Content Planner"
    },
    "role": "Plans and reviews short-form content workflows.",
    "defaultModel": "gpt-5.4",
    "dispatchableBy": [
      "main"
    ],
    "tags": [
      "content",
      "planning"
    ],
    "allowedTools": [
      "bakin_exec_tasks_list",
      "bakin_exec_lesson_search",
      "bakin_exec_workflows_start"
    ],
    "allowedSkills": [
      "content-brief"
    ]
  },
  "install": {
    "createIfMissing": true,
    "adoptIfExists": true,
    "writeWorkspaceFiles": true,
    "installSkills": true,
    "installWorkflows": true,
    "enableLessons": [
      "voice"
    ]
  },
  "contributions": {
    "workspaceFiles": [
      "workspace/SOUL.md",
      "workspace/IDENTITY.md",
      "workspace/TOOLS.md"
    ],
    "skills": [
      "skills/content-brief"
    ],
    "workflows": [
      "workflows/draft-review.yaml"
    ],
    "lessons": [
      "lessons/voice.md"
    ]
  }
}
```
<!-- /docs:snippet -->

## Package Kinds

<div class="table-light-full table-label-wrap">

| Kind | Purpose |
| --- | --- |
| `agent` | Install or adopt an agent and project its workspace files, skills, workflows, lessons, and assets. |
| `skill-pack` | Ship reusable skills without creating an agent. |
| `workflow-pack` | Ship workflows and workflow skills. |
| `lesson-pack` | Ship reusable lesson files. |

</div>

## Base Fields

Every package has `id`, `name`, `version`, `kind`, and optional `description`, `bakin`, and `author`.

Package IDs may contain letters, numbers, dashes, and underscores, up to 40 characters. Versions use `MAJOR.MINOR.PATCH` with an optional prerelease suffix.

## Agent Fields

`kind: "agent"` packages include `agent`, `install`, and `contributions`.

<div class="table-light-full table-label-wrap">

| Field | Meaning |
| --- | --- |
| `agent.identity.name` | Display name for the runtime agent. |
| `agent.identity.emoji` | Optional small visual marker. |
| `agent.role` | One-line role summary. |
| `agent.defaultModel` | Preferred model assignment. If the home it is installed on cannot run that model (for example, no login for its provider), the agent is created on the home's default model instead and the install says so. |
| `agent.dispatchableBy` | Agent IDs allowed to dispatch work to this agent. `main` is the normal human entry point. |
| `agent.tags` | Search and grouping metadata. |
| `agent.allowedTools` | Optional MCP tool restriction list. Missing or empty means unrestricted; non-empty lists are enforced by Bakin's MCP server. |
| `agent.allowedSkills` | Declarative skill allow-list. |

</div>

## Install Behavior

<div class="table-light-full table-label-wrap">

| Field | Meaning |
| --- | --- |
| `createIfMissing` | Create the runtime agent if it does not exist. |
| `adoptIfExists` | Adopt an existing runtime agent instead of refusing install. |
| `writeWorkspaceFiles` | Write template workspace files on fresh install. |
| `installSkills` | Install contributed skills. |
| `installWorkflows` | Install contributed workflows and workflow skills. |
| `enableLessons` | Lesson IDs enabled by default. |

</div>

Use `--adopt` when an existing runtime agent should become managed by the package. Use `--replace` only when intentionally replacing an installed package.

## Contributions

Agent packages can contribute:

- `workspaceFiles`
- `skills`
- `workflows`
- `workflowSkills`
- `lessons`
- `assets`

`skill-pack` packages must contribute at least one skill. `workflow-pack` packages must contribute at least one workflow or workflow skill. `lesson-pack` packages must contribute at least one lesson file.

Avatar assets (`avatar.webp` / `avatar.png` / `avatar.jpg`, projected to `~/.bakin/agents/<id>/`) may ship in any of the supported formats. **Prefer WebP** — it is ~40–50% smaller than equivalent-quality JPEG for illustrated avatars. Bakin resolves and serves whichever format you ship (priority webp → png → jpg); you do not need to ship more than one.

Declared contributions are preflighted during install and update before Bakin writes the lockfile or projects files. Workspace files, assets, workflows, and workflow skills must point at real files inside the package. Skills must point at directories with a non-empty `SKILL.md`. Workflows must be valid YAML workflow definitions, and workflow skills must be Markdown files with a non-empty instruction body.

Lesson files must be real, non-empty Markdown files at `lessons/<lesson-id>.md`; the basename is the lesson ID. `enableLessons` can only name lessons contributed by the package.

## Install Commands

Install from a local path:

```sh
bakin agents install ./content-planner --install-as content-planner
```

Install from GitHub:

```sh
bakin agents install github:markhayden/content-planner --install-as content-planner
```

GitHub sources can include `@ref` for a tag, branch, or commit:

```sh
bakin agents install github:markhayden/content-planner@v0.1.0 --install-as content-planner
```

Install from a package inside a monorepo with `#subpath`:

```sh
bakin agents install github:markhayden/bakin-bits-official#agents/patch --adopt
```

## Source Dependencies

Package dependencies can point at GitHub or local sources. Pin refs for repeatable installs.

```json
{
  "dependencies": {
    "skills": [
      {
        "source": "github:markhayden/bakin-agent-skills",
        "ref": "v0.1.0",
        "items": ["content-brief"]
      }
    ]
  }
}
```

Dependency sources may be `github:user/repo`, `github:user/repo#agents/package-id`, `./relative/path`, `../relative/path`, `/absolute/path`, or `~/path`. Each dependency requires `ref`; local sources can use a local marker such as `local` when the package is not meant to be reproduced remotely.

## Authoring Rules

- Keep package IDs stable and short.
- Pin external refs when sharing packages.
- Omit `allowedTools` for normal unrestricted agents. Add entries only when the package should intentionally restrict tool access.
- Add `bakin_exec_lesson_search` when the agent should be able to look up its enabled package lessons after dispatch.
- Put reusable behavior in skills and workflows, not only in prose.
- Use lesson files for durable domain context, not one-off task state.
- Keep secrets out of packages.
- Test package install against a disposable local runtime before sharing.

## Lesson Retrieval

Enabled agent-package lessons are selected at dispatch time from the `agent-lessons` search index and injected into task prompts when relevant. Agents can also call `bakin_exec_lesson_search` for follow-up lookup; the tool only searches the calling agent's enabled lessons.

## Capability Packs

A skill-pack becomes a **capability pack** by naming a `capability` slug and declaring what its skills need. Bakin owns the whole install path — pinned downloads, dependency installs, key entry — so users never assemble anything by hand.

```json
{
  "kind": "skill-pack",
  "capability": "transcribe",
  "runtimes": ["*"],
  "platforms": ["darwin-arm64"],
  "requires": {
    "bins":    [{ "name": "tool", "version": "1.0.0", "install": { "darwin-arm64": { "url": "https://…/tool.tar.gz", "sha256": "…", "archive": { "format": "tar.gz", "member": "tool", "extractedSha256": "…" } } }, "verifyArgs": ["--help"] }],
    "npm":     [{ "name": "scripts", "source": "payload/scripts", "dependencies": { "some-lib": "1.2.3" } }],
    "models":  [{ "name": "model", "url": "https://…/model.gguf", "sha256": "…", "bytes": 940663680, "dest": "vendor/model.gguf", "env": { "TOOL_MODEL_PATH": "{dest}" } }],
    "prereqs": [{ "name": "ffmpeg", "kind": "binary", "probe": "ffmpeg", "help": "https://ffmpeg.org/download.html", "optional": true }],
    "login":   [{ "name": "Tool account", "probe": ["tool", "auth", "status"], "setup": "tool auth login", "help": "https://…", "accountEnv": "TOOL_ACCOUNT", "expect": "Logged in as ([^ ]+)" }]
  },
  "secrets": [{ "name": "SOME_API_KEY", "description": "…", "secretSlot": "provider.apiKey", "help": "https://…" }]
}
```

- **bins** install into `~/.bakin/bin` (on PATH for agent shells). The sha256 pins the download; with `archive`, it pins the tarball, `member` is extracted, and the required `extractedSha256` pins the extracted binary — Bakin checks it before running or installing the member and on every later verification.
- **npm** payloads install scripts + exact-pinned dependencies into `~/.bakin/npm/<packId>/<name>/` — reference that path in your SKILL.md. Dependencies must be exact versions, never ranges. Scripts are ESM. Bakin checks that each direct dependency resolves inside the payload at its declared version (with its entry file) before reusing a payload and after every install, and readiness reports a payload that no longer does as unresolved.
- **models** are sha256-pinned downloads into `~/.bakin/models/`; declare honest `bytes` (shown at install consent). `env` vars are injected at server boot with `{dest}` expanded to the installed path.
- **prereqs** are checked, never installed — missing required ones block readiness with your `help` link; `optional: true` ones never block.
- **login** declares how Bakin verifies the operator has signed the tool in: a read-only `probe` (argv, no shell — its first word must be one of your `bins` or a binary prereq's `probe`), the exact `setup` command shown as the fix, and an optional `accountEnv` whose value must appear in the probe's output. If the tool exits 0 even when nobody is logged in (gog does), add `expect`: a regular expression its stdout must match for the login to count, whose first capturing group (if any) is the account Bakin shows. Give every login entry a distinct `name` — it becomes the receipt's file name (`Google account (gog)` → `google-account-gog`), and the manifest refuses two entries that would share one. Bakin runs the probe after install and sync, when the user clicks **Check login** (Explore, the runtime hub, a Health card) or runs `bakin packages login-check <id>`, and when a key for one of your declared secrets is saved — never on a plain readiness read. A pack that declares `login` needs `"bakin": ">=0.1.0-rc.9"` so older hosts refuse it instead of ignoring the leg.
- **platforms** gates the whole pack per OS/arch; elsewhere it reports "not available on this platform" honestly.

Readiness for every leg surfaces on the runtime hub's Capabilities tab, `bakin check capabilities`, and the doctor. Repair (`bakin packages sync <id>`) re-projects skills and restores missing bins/payloads/models. The `bakin` range in a pack manifest is enforced at install and upgrade: a host outside it refuses the pack with both versions named.
