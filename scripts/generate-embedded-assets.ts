/**
 * Generate the embedded-assets manifest module (#147 TG1).
 *
 * Collects the SDK stylesheet and walks the directories that hold the host
 * client bundle, vendor bundles, and core plugin dist output, then writes
 * (packages/host/src/api/_embedded-assets-static.ts) that `import`s every
 * file with `{ type: 'file' }`. Bun's `--compile` resolves these imports at
 * build time and embeds the bytes in the binary; at dev time the same
 * imports resolve to absolute on-disk paths, so the same code paths work
 * unchanged in both modes.
 *
 * The generated map is keyed by the serving URL path the handlers use
 * (e.g. "/_app/main.js", "/globals.css", "/vendor/react.js",
 * "/api/plugins/tasks/assets/client.js") so the handlers only need a
 * single lookup.
 *
 * NOTE: this must run AFTER build:vendors / build:plugins / build:host-shell
 * and BEFORE `bun build --compile`. The binary-build orchestrator
 * (scripts/build-binary.ts) enforces that order.
 *
 * Exported pieces (`collectAssets`, `emitManifest`) are pure with respect to
 * the passed root so tests can run them against fixture trees; `main()` only
 * executes when the script is the entrypoint (build-binary.ts spawns it).
 */
import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, relative, dirname } from 'node:path'
import { walkFiles } from '../packages/core/src/storage/walk'

const OUT_FILE_REL = 'packages/host/src/api/_embedded-assets-static.ts'
const REQUIRED_ASSETS: Array<{ path: string; build: string }> = [
  {
    path: 'packages/sdk/styles.css',
    build: 'bun run build:css',
  },
  {
    path: 'packages/host/dist/main.js',
    build: 'bun run build:host-shell',
  },
]

/**
 * The only core plugin dist files the browser ever fetches (#421). Server
 * bundles (index.js) and server-build artifacts (file-typed import emissions)
 * must not ship as servable browser assets — core plugin server activation
 * uses the static import table in src/lib/plugin-static-imports.ts, never
 * dist/index.js. Anything outside this list is skipped with a build-time log.
 */
const CORE_PLUGIN_ASSET_ALLOWLIST = new Set(['client.js', 'client.css'])

export interface AssetSource {
  /** Absolute path on disk. */
  absPath: string
  /** URL path the HTTP handlers serve this asset under. */
  urlPath: string
  /** Identifier-safe variable name for the generated import. */
  varName: string
}

export function collectAssets(repoRoot: string): AssetSource[] {
  // Per-call collision counter — module-level state would leak `_N` suffixes
  // across repeated invocations in one process (tests, future callers).
  const slugCounter = new Map<string, number>()
  function makeVarName(urlPath: string): string {
    const base = 'asset_' + urlPath
      .replace(/^\//, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
    const n = slugCounter.get(base) ?? 0
    slugCounter.set(base, n + 1)
    return n === 0 ? base : `${base}_${n}`
  }

  function walk(dir: string, prefix: string, out: AssetSource[]): void {
    for (const file of walkFiles(dir)) {
      // Skip source maps — we don't need to ship them with the binary and
      // Vite's define plugin chokes on .map files being treated as modules
      // during test module graph traversal.
      if (file.name.endsWith('.map')) continue
      const urlPath = `${prefix}/${file.relPath}`
      out.push({ absPath: file.path, urlPath, varName: makeVarName(urlPath) })
    }
  }

  const assets: AssetSource[] = []

  // Host client bundle — served under /_app/* (NOT /assets/* — that's the
  // assets plugin's page namespace; the old shared prefix made hard refreshes
  // of /assets/<assetId> 404 instead of reaching the SPA fallback).
  walk(join(repoRoot, 'packages/host/dist'), '/_app', assets)

  // The host and SDK publish one canonical compiled design-system stylesheet.
  const sdkStyles = join(repoRoot, 'packages/sdk/styles.css')
  if (existsSync(sdkStyles)) {
    assets.push({
      absPath: sdkStyles,
      urlPath: '/globals.css',
      varName: makeVarName('/globals.css'),
    })
  }

  // Public static files — served at their path under / (minus /vendor, handled below)
  const publicDir = join(repoRoot, 'packages/host/public')
  if (existsSync(publicDir)) {
    for (const entry of readdirSync(publicDir, { withFileTypes: true })) {
      const full = join(publicDir, String(entry.name))
      if (entry.isFile() && entry.name !== 'globals.css') {
        assets.push({
          absPath: full,
          urlPath: `/${entry.name}`,
          varName: makeVarName(`/${entry.name}`),
        })
      }
    }
    // Vendor bundles — served under /vendor/*
    walk(join(publicDir, 'vendor'), '/vendor', assets)
    // NOTE: __bakin-dev/ is naturally excluded (we only descend into
    // the subdirectories we explicitly walk). Keep it that way — the
    // dev-client bundle must never land in the compiled binary.
  }

  // Core plugin dist — served under /api/plugins/<id>/assets/*. Browser
  // assets only (CORE_PLUGIN_ASSET_ALLOWLIST); everything else is logged and
  // dropped so exclusions stay visible in build output.
  const pluginsDir = join(repoRoot, 'plugins')
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const id = String(entry.name)
      const distDir = join(pluginsDir, id, 'dist')
      if (!existsSync(distDir)) continue
      const distAssets: AssetSource[] = []
      walk(distDir, `/api/plugins/${id}/assets`, distAssets)
      for (const asset of distAssets) {
        const fileName = asset.urlPath.slice(asset.urlPath.lastIndexOf('/') + 1)
        if (CORE_PLUGIN_ASSET_ALLOWLIST.has(fileName)) {
          assets.push(asset)
        } else {
          console.log(`embedded-assets: skip ${relative(repoRoot, asset.absPath)} (not in core-plugin allowlist)`)
        }
      }
    }
  }

  // Host static-data files — mapped to /data/<filename> and read through
  // EMBEDDED_ASSETS (e.g. curated-catalog.json, loaded by
  // src/core/curated-catalog/load.ts). Walk just the top level;
  // subdirectories don't get a default URL mapping.
  const dataDir = join(repoRoot, 'packages/host/src/data')
  if (existsSync(dataDir)) {
    for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const name = String(entry.name)
      assets.push({
        absPath: join(dataDir, name),
        urlPath: `/data/${name}`,
        varName: makeVarName(`/data/${name}`),
      })
    }
  }

  // CRITICAL exclusion: agent packages live outside the Bakin core repo and
  // must not be bundled in the binary. Users install them via curated catalog
  // entries or `bakin agents install`. The walk paths above never enter
  // agents/, so a future regression that adds an `agents/` walker breaks the
  // embedded-assets-builder architecture test instead of silently shipping
  // package bytes.

  return assets
}

function assertRequiredAssetsExist(repoRoot: string): void {
  const missing = REQUIRED_ASSETS.filter(asset => !existsSync(join(repoRoot, asset.path)))
  if (missing.length === 0) return

  const lines = missing.map(asset => (
    `  - ${asset.path} missing; run \`${asset.build}\` first`
  ))
  throw new Error(
    `Cannot generate embedded assets because required host assets are missing:\n${lines.join('\n')}`,
  )
}

/**
 * Escape a value for a single-quoted TS string literal. Asset paths are
 * repo-controlled, but a quote/backslash/newline in a filename must not break
 * out of the generated literal (audit P2 #26). Single quotes (not
 * JSON.stringify's double quotes) keep the emission byte-identical to the
 * historical format for benign names.
 */
function quoteLiteral(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}'`
}

export function emitManifest(assets: AssetSource[], outFile: string): string {
  const header = `// @ts-nocheck — every import below uses \`with { type: 'file' }\`;
// Bun resolves these at build time (for --compile) or dev time (as on-disk
// paths). TypeScript's module resolver has no concept of file-typed imports
// so we opt out of static checking for this generated module.
/**
 * Auto-generated by scripts/generate-embedded-assets.ts — DO NOT EDIT.
 *
 * Every file the binary needs to serve is imported with \`type: 'file'\`.
 * In dev, the values are absolute on-disk paths. In compiled binaries,
 * Bun rewrites them to /$bunfs/... virtual paths and embeds the bytes.
 * Either way, \`Bun.file(path)\` reads them back.
 *
 * Only imported from server.ts — the runtime facade at
 * packages/host/src/api/_embedded-assets.ts exposes the populated map
 * to route handlers.
 */
`

  const imports = assets
    .map(a => {
      const rel = relative(dirname(outFile), a.absPath)
      // Force POSIX separators for the module specifier.
      const specifier = rel.split(/[\\/]/).join('/')
      const spec = specifier.startsWith('.') ? specifier : `./${specifier}`
      return `import ${a.varName} from ${quoteLiteral(spec)} with { type: 'file' }`
    })
    .join('\n')

  const entries = assets
    .map(a => `  [${quoteLiteral(a.urlPath)}, ${a.varName}],`)
    .join('\n')

  return `${header}
${imports}

/** URL path → embedded file path. Keys are the exact paths the HTTP
 *  handlers request (including leading slash). Both core static assets
 *  and core plugin dist outputs live in this single map. */
export const EMBEDDED_ASSETS_STATIC: ReadonlyMap<string, string> = new Map([
${entries}
])

export const EMBEDDED_ASSET_COUNT = ${assets.length}
`
}

export function main(repoRoot: string = resolve(import.meta.dir, '..')): void {
  assertRequiredAssetsExist(repoRoot)
  const assets = collectAssets(repoRoot)
  if (assets.length === 0) {
    throw new Error(
      'No embeddable assets found. Run build:vendors + build:plugins + build:host-shell first.',
    )
  }
  const outFile = join(repoRoot, OUT_FILE_REL)
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, emitManifest(assets, outFile))
  console.log(`embedded-assets: wrote ${assets.length} entries to ${OUT_FILE_REL}`)
}

if (import.meta.main) {
  main()
}
