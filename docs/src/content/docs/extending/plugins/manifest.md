---
title: Plugin Manifest
description: Define the install-time plugin metadata Bakin uses to validate, load, consent to, and document a plugin.
---

Every plugin starts with `bakin-plugin.json`. Bakin reads this file before loading plugin code, so keep it explicit and stable. The manifest is not just package metadata. It is the review surface for installers, permissions, public contributions, docs generation, and lifecycle decisions.

The tested manifest fixture for these docs lives at `docs/snippets/plugin-basic/bakin-plugin.json`.

<!-- docs:snippet plugin-basic-manifest -->
Source: `docs/snippets/plugin-basic/bakin-plugin.json`

```json
{
  "id": "docs-basic",
  "name": "Docs Basic",
  "version": "0.1.0",
  "bakin": ">=0.1.0",
  "description": "Minimal plugin used by the public Bakin docs.",
  "entry": {
    "server": "index.ts",
    "client": "client.tsx"
  },
  "contributes": {
    "apiRoutes": [
      {
        "method": "GET",
        "path": "/hello",
        "summary": "Say hello",
        "description": "Returns a small JSON payload from the docs example plugin.",
        "visibility": "public",
        "stability": "stable",
        "responses": {
          "200": {
            "description": "Greeting payload"
          }
        }
      }
    ],
    "clientRoutes": [
      {
        "path": "/docs-basic",
        "summary": "Minimal docs plugin page"
      }
    ]
  },
  "permissions": [
    "storage.read"
  ]
}
```
<!-- /docs:snippet -->

## Required Fields

<div class="table-light-full table-label">

| Field | Meaning |
| --- | --- |
| `id` | Stable machine ID. Must match `^[a-z][a-z0-9-]{0,39}$`. |
| `name` | Human-readable plugin name. |
| `version` | Plugin version. Use SemVer. |
| `bakin` | Compatible Bakin version range. |
| `description` | Short public summary. |
| `entry.server` | Server entry loaded by the plugin runtime. |

</div>

## Optional Fields

<div class="table-light-full table-label-wrap">

| Field | Meaning |
| --- | --- |
| `entry.client` | Browser entry loaded into the Bakin shell. |
| `contentFiles` | Files the plugin contributes under Bakin content. |
| `secrets` | Secret names the plugin expects. |
| `tests` | Plugin-local test command. |
| `dependencies` | Other Bakin plugin IDs that must be available before this plugin loads. |
| `permissions` | Capability labels used for install consent and runtime permission checks. |
| `runtimeCapabilities` | Runtime adapter capabilities the plugin needs, such as `tasks`, `search`, `models`, or `channels.message`. |
| `contributes` | Public API, UI, CLI, settings, exec tool, and docs metadata. |
| `devWatch` | Extra plugin-local paths to watch during development. |
| `signature` | Optional Ed25519 manifest signature. Enforced only when `settings.plugins.requireSignatures` is `true`. |

</div>

## Signature Policy

By default, plugin installs use trust-on-first-use: unsigned manifests are accepted, then Bakin records the installed source and manifest hash in the plugin lockfile.

Set `settings.plugins.requireSignatures` to `true` to fail closed for unsigned, untrusted, or tampered manifests during install, dev-link, and upgrade. Trusted roots live in `settings.plugins.trustedSigners` and may be a `sha256:<hex>` public-key fingerprint, a raw base64 Ed25519 SPKI public key, or `ed25519:<base64-public-key>`.

When present, `signature` has this shape:

```json
{
  "signature": {
    "algorithm": "ed25519",
    "signer": "markhayden",
    "publicKey": "base64-spki-public-key",
    "signature": "base64-signature"
  }
}
```

The signature covers canonical JSON for `bakin-plugin.json` with the top-level `signature` block omitted. `signer` is display metadata; trust is bound to the public key or fingerprint.

## Contributions

`contributes` tells Bakin what the plugin exposes before code runs.

<div class="table-light-full table-label-wrap">

| Contribution | Required core fields |
| --- | --- |
| `apiRoutes[]` | `method`, plugin-relative `path`, `summary` |
| `clientRoutes[]` | app `path`, `summary` |
| `execTools[]` | `name`, `summary` |
| `cliCommands[]` | `name`, `usage`, `summary`, `dispatch` |
| `settings[]` | `key`, `summary` |
| `docs` | `slug` |

</div>

API route paths are plugin-relative. A route declared as `/hello` is exposed under `/api/plugins/{pluginId}/hello`. Do not declare `/api/...` paths in a plugin manifest.

Exec tool names must use the plugin-owned MCP namespace: `bakin_exec_{pluginId}_{action}`. The manifest declaration and runtime `ctx.registerExecTool()` call must agree. Bakin rejects undeclared tools, duplicate tool names, and user plugin tools that register outside their own plugin prefix.

## Permissions

Declare permissions before calling the corresponding APIs.

<!-- docs:plugin-permissions -->
<div class="table-light-full table-label-wrap permissions-table">

| Permission | Typical use |
| --- | --- |
| `events.emit` | Broadcast Server-Sent Events to connected browsers |
| `assets.read` | Read asset metadata and runtime-deliverable asset references |
| `assets.write` | Save files into the asset store and write asset metadata |
| `runtime.read` | Read general runtime adapter state |
| `runtime.agents` | Read runtime agent identity and status |
| `runtime.messaging` | Send messages through the runtime adapter |
| `runtime.channels` | Send messages or content to configured runtime channels |
| `runtime.cron` | Create and manage runtime cron jobs |
| `runtime.skills` | Read runtime skills |
| `runtime.models` | Read runtime model metadata |
| `runtime.images` | Generate images through the configured runtime adapter |
| `search.read` | Query Bakin search indexes |
| `search.write` | Register or mutate plugin-owned search indexes |
| `storage.read` | Read files in ~/.bakin/ |
| `storage.write` | Write files in ~/.bakin/ |
| `tasks.read` | Read tasks through the public task service |
| `tasks.write` | Create and mutate tasks through the public task service |

</div>
<!-- /docs:plugin-permissions -->

Runtime permission mode may warn or enforce depending on configuration. Missing declarations are still bugs: they show up in audit trails and can become hard failures.

## Authoring Rules

- Treat `id` as permanent once users install the plugin.
- Keep entry paths relative to the plugin root.
- Declare plugin dependencies by plugin ID. `bakin plugins install` refuses a plugin when a dependency is neither core nor already installed.
- Keep `contributes` in sync with registered routes, tools, settings, and docs.
- Use `runtimeCapabilities` for adapter-level needs and `permissions` for plugin capability consent.
- Import supported APIs from `@makinbakin/sdk` and `@makinbakin/sdk/*`.

## Validation

Docs examples that show real files should be backed by snippet fixtures. `bun run docs:check` validates `bakin` shell commands, source-backed snippets, generated docs blocks, route metadata, JSON fences, and the docs site build.
