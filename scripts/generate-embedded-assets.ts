/**
 * Generate the embedded-assets manifest module (#147 TG1).
 *
 * Walks the three directories that hold the host client bundle, vendor
 * bundles, and core plugin dist output, and writes a TypeScript module
 * (packages/host/src/api/_embedded-assets.ts) that `import`s every file
 * with `{ type: 'file' }`. Bun's `--compile` resolves these imports at
 * build time and embeds the bytes in the binary; at dev time the same
 * imports resolve to absolute on-disk paths, so the same code paths work
 * unchanged in both modes.
 *
 * The generated map is keyed by the serving URL path the handlers use
 * (e.g. "/assets/main.js", "/globals.css", "/vendor/react.js",
 * "/api/plugins/tasks/assets/client.js") so the handlers only need a
 * single lookup.
 *
 * NOTE: this must run AFTER build:vendors / build:plugins / build:host-shell
 * and BEFORE `bun build --compile`. The binary-build orchestrator
 * (scripts/build-binary.ts) enforces that order.
 */
import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, relative, dirname } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const OUT_FILE = join(REPO_ROOT, 'packages/host/src/api/_embedded-assets-static.ts')
const REQUIRED_ASSETS: Array<{ path: string; build: string }> = [
  {
    path: join(REPO_ROOT, 'packages/host/public/globals.css'),
    build: 'bun run build:css',
  },
  {
    path: join(REPO_ROOT, 'packages/host/dist/main.js'),
    build: 'bun run build:host-shell',
  },
]

interface AssetSource {
  /** Absolute path on disk. */
  absPath: string
  /** URL path the HTTP handlers serve this asset under. */
  urlPath: string
  /** Identifier-safe variable name for the generated import. */
  varName: string
}

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
  if (!existsSync(dir)) return
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const name = String(entry.name)
    // Skip source maps — we don't need to ship them with the binary and
    // Vite's define plugin chokes on .map files being treated as modules
    // during test module graph traversal.
    if (name.endsWith('.map')) continue
    const full = join(dir, name)
    if (entry.isDirectory()) {
      walk(full, `${prefix}/${name}`, out)
    } else if (entry.isFile()) {
      const urlPath = `${prefix}/${name}`
      out.push({ absPath: full, urlPath, varName: makeVarName(urlPath) })
    }
  }
}

function collectAssets(): AssetSource[] {
  const assets: AssetSource[] = []

  // Host client bundle — served under /assets/*
  walk(join(REPO_ROOT, 'packages/host/dist'), '/assets', assets)

  // Public static files — served at their path under / (minus /vendor, handled below)
  const publicDir = join(REPO_ROOT, 'packages/host/public')
  if (existsSync(publicDir)) {
    for (const entry of readdirSync(publicDir, { withFileTypes: true })) {
      const full = join(publicDir, String(entry.name))
      if (entry.isFile()) {
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

  // Core plugin dist — served under /api/plugins/<id>/assets/*
  const pluginsDir = join(REPO_ROOT, 'plugins')
  if (existsSync(pluginsDir)) {
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const id = String(entry.name)
      const distDir = join(pluginsDir, id, 'dist')
      if (!existsSync(distDir)) continue
      walk(distDir, `/api/plugins/${id}/assets`, assets)
    }
  }

  // Host static-data files — served at /api/<filename> by per-route
  // handlers (e.g. curated-agents.json → /api/curated). Walk just the
  // top level; subdirectories don't get a default URL mapping.
  const dataDir = join(REPO_ROOT, 'packages/host/src/data')
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
  // API curated-catalog test instead of silently shipping package bytes.

  return assets
}

function assertRequiredAssetsExist(): void {
  const missing = REQUIRED_ASSETS.filter(asset => !existsSync(asset.path))
  if (missing.length === 0) return

  const lines = missing.map(asset => (
    `  - ${relative(REPO_ROOT, asset.path)} missing; run \`${asset.build}\` first`
  ))
  throw new Error(
    `Cannot generate embedded assets because required host assets are missing:\n${lines.join('\n')}`,
  )
}

function emitManifest(assets: AssetSource[]): string {
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
      const rel = relative(dirname(OUT_FILE), a.absPath)
      // Force POSIX separators for the module specifier.
      const specifier = rel.split(/[\\/]/).join('/')
      const spec = specifier.startsWith('.') ? specifier : `./${specifier}`
      return `import ${a.varName} from '${spec}' with { type: 'file' }`
    })
    .join('\n')

  const entries = assets
    .map(a => `  ['${a.urlPath}', ${a.varName}],`)
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

function main(): void {
  assertRequiredAssetsExist()
  const assets = collectAssets()
  if (assets.length === 0) {
    throw new Error(
      'No embeddable assets found. Run build:vendors + build:plugins + build:host-shell first.',
    )
  }
  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, emitManifest(assets))
  console.log(`embedded-assets: wrote ${assets.length} entries to ${relative(REPO_ROOT, OUT_FILE)}`)
}

main()

export {}
