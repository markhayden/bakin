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
  else if (!isFile(pkgJson)) problems.push('package.json is not a file')
  else if (readText(pkgJson) !== generated) problems.push('package.json differs from the declared dependency set')

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

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/** File contents, or null when unreadable — a verdict, never an exception. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function readBytes(path: string): Buffer | null {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

const INSTALL_ARTIFACTS = new Set(['package.json', 'bunfig.toml', 'bun.lock', 'bun.lockb'])

/** Every file in the pack's script dir exists in the payload with identical bytes (the generated package.json always wins). */
function compareScripts(source: string, payloadDir: string): string[] {
  if (!isDirectory(source)) return [`pack script dir is missing (${source})`]
  const payloadReal = realpathOrNull(payloadDir) ?? payloadDir
  const problems: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      problems.push(`pack script dir ${relative(source, dir) || '.'} is unreadable`)
      return
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(source, abs)
      if (entry.isDirectory()) { walk(abs); continue }
      // Bakin generates package.json and bunfig.toml; bun rewrites its own
      // lockfiles against them during install — none of these are scripts.
      if (INSTALL_ARTIFACTS.has(rel)) continue
      const copy = join(payloadDir, rel)
      if (!isFile(copy)) { problems.push(`script ${rel} is missing`); continue }
      // Node resolves a script's imports from its REAL location: a script
      // that is (or sits under a directory that is) a symlink out of the
      // payload would run against some other tree's dependencies.
      const real = realpathOrNull(copy)
      if (!real || !real.startsWith(payloadReal + sep)) { problems.push(`script ${rel} resolves outside the payload`); continue }
      const want = readBytes(abs)
      const have = readBytes(copy)
      if (!want || !have) problems.push(`script ${rel} is unreadable`)
      else if (!have.equals(want)) problems.push(`script ${rel} differs from the pack`)
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
    parsed = JSON.parse(readText(join(resolved, 'package.json')) ?? '')
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
    if ('invalid' in entry) { problems.push(`dependency ${name} has an invalid target for ${entry.label.replace(/^its /, '')}: ${entry.invalid}`); continue }
    const found = entry.candidates.find((candidate) => isFile(join(resolved, candidate)))
    if (!found) { problems.push(`dependency ${name} is missing ${entry.label} ${entry.candidates[0]}`); continue }
    // Node follows a symlinked entry — it must stay inside the payload too.
    const real = realpathSync(join(resolved, found))
    if (!real.startsWith(boundary + sep)) problems.push(`dependency ${name}: ${entry.label.replace(/^its /, '')} resolves outside the payload (${real})`)
  }
  return problems
}

/**
 * The conditions active when a payload script (ESM, run by Node) imports a
 * dependency. Condition maps match in THEIR declaration order — Node's rule.
 */
const ACTIVE_CONDITIONS = new Set(['node', 'import', 'module-sync', 'default'])

/**
 * Node's PACKAGE_TARGET_RESOLVE, for the cases a verifier needs:
 *   file    — a valid target ("./…", no `..`/`node_modules` segments)
 *   blocked — an explicit `null` (Node refuses the subpath)
 *   none    — no condition matched (undefined in Node's algorithm)
 *   invalid — a malformed target (Node throws; arrays fall back past it)
 *   config  — a malformed exports CONFIGURATION (ERR_INVALID_PACKAGE_CONFIG):
 *             fatal everywhere, arrays never fall back past it
 */
type TargetResolution = { kind: 'file'; path: string } | { kind: 'blocked' } | { kind: 'none' } | { kind: 'invalid'; reason: string } | { kind: 'config'; reason: string }

/**
 * A string target, with Node's URL semantics: it must start with "./",
 * no "."/".."/"node_modules" segment (raw or percent-decoded), no encoded
 * "/" or "\\"; the file is the URL's decoded path (query and hash dropped).
 */
function validTarget(target: string): TargetResolution {
  if (!target.startsWith('./')) return { kind: 'invalid', reason: `"${target}" does not start with "./"` }
  if (/%2f|%5c/i.test(target)) return { kind: 'invalid', reason: `"${target}" encodes a path separator` }
  const badSegment = (path: string): boolean => path.split(/[\\/]/).some((raw) => {
    // Judge each segment percent-DECODED, before any URL normalisation can
    // collapse it ("%2e%2e" is ".." — Node rejects it, never resolves it).
    const segment = decodeSegment(raw)
    return segment === '..' || segment === '.' || segment.toLowerCase() === 'node_modules'
  })
  if (badSegment(target.slice(2))) return { kind: 'invalid', reason: `"${target}" leaves the package` }
  let path: string
  try {
    const url = new URL(target, 'file:///__package__/')
    path = decodeURIComponent(url.pathname.slice('/__package__/'.length))
  } catch {
    return { kind: 'invalid', reason: `"${target}" is not a valid URL path` }
  }
  if (badSegment(path)) return { kind: 'invalid', reason: `"${target}" leaves the package` }
  return { kind: 'file', path }
}

/** A percent-decoded path segment; a malformed escape is judged as written. */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Node refuses numeric condition keys (ERR_INVALID_PACKAGE_CONFIG). */
const NUMERIC_KEY = /^\d+$/

function resolveTarget(target: unknown): TargetResolution {
  if (typeof target === 'string') return validTarget(target)
  if (target === null) return { kind: 'blocked' }
  if (Array.isArray(target)) {
    if (target.length === 0) return { kind: 'blocked' }
    // Node's array fallback: invalid targets and nulls are skipped; if
    // nothing resolves, the last invalid (or null) is the outcome.
    let last: TargetResolution = { kind: 'none' }
    for (const item of target) {
      const resolved = resolveTarget(item)
      if (resolved.kind === 'config') return resolved
      if (resolved.kind === 'invalid' || resolved.kind === 'blocked') { last = resolved; continue }
      if (resolved.kind === 'none') continue
      return resolved
    }
    return last
  }
  if (target && typeof target === 'object') {
    for (const [condition, value] of Object.entries(target)) {
      if (NUMERIC_KEY.test(condition)) return { kind: 'config', reason: `condition key "${condition}" is numeric` }
      if (!ACTIVE_CONDITIONS.has(condition)) continue
      const resolved = resolveTarget(value)
      if (resolved.kind === 'none') continue
      return resolved
    }
    return { kind: 'none' }
  }
  return { kind: 'invalid', reason: 'not a string, array, object or null' }
}

type EntryCheck =
  /** Any one existing satisfies the check (Node's main fallbacks); one entry for exact targets. */
  | { label: string; candidates: string[] }
  | { label: string; invalid: string }

/**
 * The files Node needs for this package, relative to its dir:
 *   - with non-null `exports`: the target of the root and of every subpath
 *     key, resolved as Node does (URL semantics; a map mixing subpath and
 *     condition keys, or numeric condition keys, is invalid) — a blocked
 *     (null) or unmatched subpath needs nothing; a `*` target is a pattern
 *     only behind a pattern key, otherwise a literal file to check;
 *   - otherwise (`exports` absent or null): `main` with Node's extension and
 *     directory-index fallbacks, then the package root's index.* files.
 * `module` is a bundler field Node never reads, so it is not checked.
 */
function entryChecks(pkg: { exports?: unknown; main?: unknown }): EntryCheck[] {
  const exportsField = pkg.exports
  if (exportsField !== undefined && exportsField !== null) {
    const isMap = typeof exportsField === 'object' && !Array.isArray(exportsField)
    const keys = isMap ? Object.keys(exportsField) : []
    const dotted = keys.filter((key) => key.startsWith('.')).length
    // Node rejects a map mixing subpath keys and condition keys.
    if (dotted > 0 && dotted < keys.length) {
      return [{ label: 'its exports map', invalid: 'mixes subpath keys (".…") with condition keys' }]
    }
    const subpaths: Array<[string, unknown]> = dotted > 0 ? Object.entries(exportsField as Record<string, unknown>) : [['.', exportsField]]
    const checks: EntryCheck[] = []
    for (const [subpath, target] of subpaths) {
      // Legacy folder mappings ("./": "./", "./lib/": …) are ignored by Node's
      // resolver — they name directories, not files to check.
      if (subpath.endsWith('/')) continue
      const label = subpath === '.' ? 'its entry file' : `its export ${subpath}`
      const resolved = resolveTarget(target)
      if (resolved.kind === 'invalid' || resolved.kind === 'config') checks.push({ label, invalid: resolved.reason })
      // A "*" is a pattern only behind a pattern KEY; otherwise it is literal.
      else if (resolved.kind === 'file' && !(subpath.includes('*') && resolved.path.includes('*'))) checks.push({ label, candidates: [resolved.path] })
    }
    return checks
  }
  const rootIndex = ['index.js', 'index.json', 'index.node']
  if (typeof pkg.main === 'string' && pkg.main.length > 0) {
    const main = pkg.main.replace(/^\.\//, '')
    return [{ label: 'its entry file', candidates: [main, `${main}.js`, `${main}.json`, `${main}.node`, join(main, 'index.js'), join(main, 'index.json'), join(main, 'index.node'), ...rootIndex] }]
  }
  return [{ label: 'its entry file', candidates: rootIndex }]
}
