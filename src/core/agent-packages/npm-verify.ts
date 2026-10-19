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
 *     declared name and exact version, and its entry file (exports "." /
 *     module / main / index.js) exists.
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
  if (deps.length > 0 && !isDirectory(modules)) problems.push('node_modules is missing')
  else for (const [name, version] of deps) problems.push(...verifyDependency(modules, name, version))

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
function verifyDependency(modules: string, name: string, version: string): string[] {
  const dir = join(modules, ...name.split('/'))
  let resolved: string
  try {
    lstatSync(dir)
    resolved = realpathSync(dir)
  } catch {
    return [`dependency ${name} is not installed in the payload`]
  }
  const modulesReal = realpathSync(modules)
  if (resolved !== modulesReal && !resolved.startsWith(modulesReal + sep)) {
    return [`dependency ${name} resolves outside the payload (${resolved})`]
  }
  let pkg: { name?: unknown; version?: unknown; exports?: unknown; module?: unknown; main?: unknown }
  try {
    pkg = JSON.parse(readFileSync(join(resolved, 'package.json'), 'utf-8'))
  } catch {
    return [`dependency ${name} has no readable package.json`]
  }
  const problems: string[] = []
  if (pkg.name !== name) problems.push(`dependency ${name} is installed as "${String(pkg.name)}"`)
  if (pkg.version !== version) problems.push(`dependency ${name} is ${String(pkg.version)}, not the declared ${version}`)
  const candidates = entryCandidates(pkg)
  if (candidates.length > 0 && !candidates.some((candidate) => isFile(join(resolved, candidate)))) {
    problems.push(`dependency ${name} is missing its entry file ${candidates[0]}`)
  }
  return problems
}

const CONDITIONS = ['import', 'node', 'default', 'require'] as const

/** The first file a condition map resolves to, or null when it names none. */
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
    for (const condition of CONDITIONS) {
      if (condition in value) {
        const target = conditionTarget((value as Record<string, unknown>)[condition])
        if (target) return target
      }
    }
  }
  return null
}

/**
 * Where the package's root entry may live, relative to its dir, in Node's
 * resolution order: `exports["."]` (or a bare exports string / condition
 * map) is exact; `module`, then `main` (with Node's extension and
 * directory-index fallbacks); else `index.js`. Empty when `exports` defines
 * only subpaths — there is no root entry to check.
 */
function entryCandidates(pkg: { exports?: unknown; module?: unknown; main?: unknown }): string[] {
  const strip = (path: string): string => path.replace(/^\.\//, '')
  if (pkg.exports !== undefined) {
    const exportsField = pkg.exports
    const root = exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)
      && Object.keys(exportsField).some((key) => key.startsWith('.'))
      ? (exportsField as Record<string, unknown>)['.']
      : exportsField
    if (root === undefined) return []
    const target = conditionTarget(root)
    return target ? [strip(target)] : []
  }
  if (typeof pkg.module === 'string') return [strip(pkg.module)]
  if (typeof pkg.main === 'string' && pkg.main.length > 0) {
    const main = strip(pkg.main)
    return [main, `${main}.js`, `${main}.json`, `${main}.node`, join(main, 'index.js'), join(main, 'index.json')]
  }
  return ['index.js', 'index.json', 'index.node']
}
