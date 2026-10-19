/**
 * The ONE "do this npm payload's dependencies resolve?" predicate (#898 F).
 *
 * An npm payload (`<bakin-home>/npm/<packId>/<name>/`) is usable when:
 *   - its package.json is exactly the manifest Bakin generates for the
 *     requirement (the declared, exact-pinned dependency set);
 *   - (when the pack source is given) every payload script matches the
 *     pack's copy byte for byte;
 *   - every DIRECT dependency resolves INSIDE the payload's own
 *     node_modules — never an ancestor or global fallback — with the
 *     declared name and exact version, and the files Node would load exist
 *     (every concrete `exports` target, resolved under ESM conditions in
 *     declaration order; else `main` / index.js).
 *
 * It reads files only: no imports, no subprocesses, no network — cheap
 * enough for every readiness/doctor run. It proves "dependencies resolved at
 * declared versions", never "integrity verified": npm packages carry no
 * Bakin-held content pins.
 *
 * Callers: the installer's reuse fast path and its post-install staging
 * check (`requirements-installer.ts`), and the capability-readiness npm leg.
 */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import type { NpmRequirement } from '../../../packages/core/src/agent-packages/manifest'

/** The package.json Bakin writes into every npm payload. */
export function generatedNpmManifest(packId: string, req: Pick<NpmRequirement, 'name' | 'dependencies'>): string {
  return JSON.stringify(
    // type:module — payload scripts in this ecosystem are ESM (upstream
    // pi-skills convention); without it node re-parses on every run.
    { name: `bakin-pack-${packId}-${req.name}`, private: true, type: 'module', dependencies: req.dependencies },
    null,
    2,
  )
}

export type NpmPayloadVerdict = { ok: true } | { ok: false; problems: string[] }

interface VerifyOptions {
  /** The pack-relative script dir to compare payload scripts with. Omitted ⇒ scripts are not compared. */
  scriptsSource?: string
}

export function verifyNpmPayload(
  payloadDir: string,
  packId: string,
  req: Pick<NpmRequirement, 'name' | 'dependencies'>,
  options: VerifyOptions = {},
): NpmPayloadVerdict {
  const problems: string[] = []
  if (!isDirectory(payloadDir)) return { ok: false, problems: ['payload directory is missing'] }

  const pkgJson = join(payloadDir, 'package.json')
  const generated = generatedNpmManifest(packId, req)
  if (!existsSync(pkgJson)) problems.push('package.json is missing')
  else if (readFileSync(pkgJson, 'utf-8') !== generated) problems.push('package.json differs from the declared dependency set')

  if (options.scriptsSource) problems.push(...compareScripts(options.scriptsSource, payloadDir))

  const modules = join(payloadDir, 'node_modules')
  const deps = Object.entries(req.dependencies)
  if (deps.length > 0) {
    // The containment boundary is the payload's OWN node_modules: it must be
    // a real directory there, never a symlink out to an ancestor or another
    // tree (which would make every dependency "inside" it trivially).
    const boundary = join(realpathSync(payloadDir), 'node_modules')
    if (!isDirectory(modules)) problems.push('node_modules is missing')
    else if (lstatSync(modules).isSymbolicLink()) problems.push('node_modules is a symlink, not the payload\'s own directory')
    else for (const [name, version] of deps) problems.push(...verifyDependency(modules, boundary, name, version))
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Every file in the pack's script dir exists in the payload with identical bytes (the generated package.json always wins). */
function compareScripts(source: string, payloadDir: string): string[] {
  if (!isDirectory(source)) return [`pack script dir is missing (${source})`]
  const problems: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const rel = relative(source, abs)
      if (entry.isDirectory()) { walk(abs); continue }
      if (rel === 'package.json') continue
      const copy = join(payloadDir, rel)
      if (!isFile(copy)) problems.push(`script ${rel} is missing`)
      else if (!readFileSync(copy).equals(readFileSync(abs))) problems.push(`script ${rel} differs from the pack`)
    }
  }
  walk(source)
  return problems
}

/**
 * A direct dependency resolves ONLY at `<payload>/node_modules/<name>` (a
 * scoped `@scope/pkg` included). A symlink (isolated linkers) is followed
 * but must stay inside the payload's node_modules — never an ancestor's.
 */
function verifyDependency(modules: string, boundary: string, name: string, version: string): string[] {
  const dir = join(modules, ...name.split('/'))
  let resolved: string
  try {
    lstatSync(dir)
    resolved = realpathSync(dir)
  } catch {
    return [`dependency ${name} is not installed in the payload`]
  }
  if (!resolved.startsWith(boundary + sep)) {
    return [`dependency ${name} resolves outside the payload (${resolved})`]
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(resolved, 'package.json'), 'utf-8'))
  } catch {
    return [`dependency ${name} has no readable package.json`]
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [`dependency ${name} has a malformed package.json`]
  }
  const pkg = parsed as { name?: unknown; version?: unknown; exports?: unknown; main?: unknown }
  const problems: string[] = []
  if (pkg.name !== name) problems.push(`dependency ${name} is installed as "${String(pkg.name)}"`)
  if (pkg.version !== version) problems.push(`dependency ${name} is ${String(pkg.version)}, not the declared ${version}`)
  for (const entry of entryChecks(pkg)) {
    if (!entry.candidates.some((candidate) => isFile(join(resolved, candidate)))) {
      problems.push(`dependency ${name} is missing ${entry.label} ${entry.candidates[0]}`)
    }
  }
  return problems
}

/**
 * The conditions active when a payload script (ESM, run by Node) imports a
 * dependency. Matching walks each condition map in ITS declaration order —
 * Node's rule — so `{ node, import }` resolves to `node` (#898 F review).
 */
const ACTIVE_CONDITIONS = new Set(['node', 'import', 'module-sync', 'default'])

/** The file a target resolves to under the active conditions, or null when nothing matches. */
function conditionTarget(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = conditionTarget(item)
      if (target) return target
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const [condition, target] of Object.entries(value)) {
      if (!ACTIVE_CONDITIONS.has(condition)) continue
      const resolved = conditionTarget(target)
      if (resolved) return resolved
    }
  }
  return null
}

interface EntryCheck {
  label: string
  /** Any one existing satisfies the check (Node's main fallbacks); one entry for exact targets. */
  candidates: string[]
}

/**
 * The files Node needs for this package, relative to its dir:
 *   - with `exports`: the root target (exports "." or a bare string /
 *     condition map) AND every concrete subpath target (no `*` patterns,
 *     null = explicitly blocked) — a missing exported file is unresolved;
 *   - otherwise `main` with Node's extension/index fallbacks, else index.js.
 * `module` is a bundler field Node never reads, so it is not checked.
 */
function entryChecks(pkg: { exports?: unknown; main?: unknown }): EntryCheck[] {
  const strip = (path: string): string => path.replace(/^\.\//, '')
  if (pkg.exports !== undefined) {
    const exportsField = pkg.exports
    const isSubpathMap = exportsField !== null && typeof exportsField === 'object' && !Array.isArray(exportsField)
      && Object.keys(exportsField).some((key) => key.startsWith('.'))
    const subpaths: Array<[string, unknown]> = isSubpathMap ? Object.entries(exportsField as Record<string, unknown>) : [['.', exportsField]]
    const checks: EntryCheck[] = []
    for (const [subpath, target] of subpaths) {
      if (subpath.includes('*')) continue
      const file = conditionTarget(target)
      if (!file || file.includes('*')) continue
      checks.push({ label: subpath === '.' ? 'its entry file' : `its export ${subpath}`, candidates: [strip(file)] })
    }
    return checks
  }
  if (typeof pkg.main === 'string' && pkg.main.length > 0) {
    const main = strip(pkg.main)
    return [{ label: 'its entry file', candidates: [main, `${main}.js`, `${main}.json`, `${main}.node`, join(main, 'index.js'), join(main, 'index.json'), join(main, 'index.node')] }]
  }
  return [{ label: 'its entry file', candidates: ['index.js', 'index.json', 'index.node'] }]
}
