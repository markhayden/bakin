/**
 * Three outcomes (self-healing PR1, spec D1): every Health incident resolves
 * as `repair { actionId }` or `human { needs, href }`. This scan keeps the
 * retired vocabulary (`instructions`, `rerun`, `navigate`, `safety` tiers)
 * out of production and its direct tests, pins the shared engine actions to
 * the core registrations, and checks the re-homing table's catalogs are
 * declared: every check the table names registers an `incidents` catalog.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { SHARED_ENGINE_ACTIONS } from '../../packages/core/src/health/authorize-mutation'

const ROOT = process.cwd()
const SELF = 'tests/architecture/health-three-outcomes.test.ts'
const SCAN_ROOTS = ['packages', 'plugins', 'src', 'tests', 'cli', 'examples']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.astro'])
const SKIP_FILES = new Set([SELF, 'packages/host/src/api/_embedded-assets-static.ts'])

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(?:ts|tsx)$/.test(name)) yield full
  }
}

const files = SCAN_ROOTS.flatMap((root) => [...walk(join(ROOT, root))])
  .map((file) => ({ path: relative(ROOT, file), source: readFileSync(file, 'utf8') }))
  .filter((file) => !SKIP_FILES.has(file.path))

function matches(pattern: RegExp, scoped = files, allow: readonly string[] = []): string[] {
  return scoped
    .filter((file) => !allow.includes(file.path))
    .flatMap((file) => file.source.split('\n').flatMap((line, index) => {
      pattern.lastIndex = 0
      return pattern.test(line) ? [`${file.path}:${index + 1}: ${line.trim()}`] : []
    }))
}

/** Tests that deliberately keep a retired shape: the contract's own refusal pins and rc.42-shaped legacy fixtures. */
const LEGACY_SHAPE_ALLOWED = [
  'tests/core/health-contract.test.ts',
  'tests/sdk-testing/health-contract.test.ts',
  'tests/core/approvals/legacy-retire.test.ts',
  'tests/core/doctor-registration-teeth.test.ts',
  'tests/core/doctor-repair-store.test.ts', // the refused-record archive is fed a pre-cutover proposal on purpose
]

/** Health producers and their direct consumers: where a resolution literal is a contract statement. */
function isHealthSurface(path: string): boolean {
  return path.startsWith('plugins/health/')
    || /\/lib\/health-checks\.ts$/.test(path)
    || /^packages\/adapter-[a-z]+\/src\/health-checks\.ts$/.test(path)
    || /^src\/core\/(?:doctor|health-)/.test(path)
    || /^src\/(?:cli\/commands|core\/cli\/ui)\/doctor/.test(path)
    || path === 'packages/sdk/src/types/health.ts'
    || path === 'src/cli/commands/doctor.ts'
    || /^tests\/(?:cli\/doctor|core\/(?:doctor|health)|plugins\/[a-z-]+\/(?:health|re-homing|actions)|adapter-[a-z]+\/)/.test(path)
}

describe('three outcomes — retired vocabulary stays retired', () => {
  it('has no retired resolution or safety types anywhere', () => {
    expect(matches(/\bHealth(?:Instructions|Navigate|Rerun)Resolution\b|\bHealthRepairSafety\b/)).toEqual([])
  })

  it('emits no instructions / rerun / navigate resolutions on Health surfaces', () => {
    const health = files.filter((file) => isHealthSurface(file.path))
    expect(matches(/type:\s*['"](?:instructions|rerun|navigate)['"]/, health, LEGACY_SHAPE_ALLOWED)).toEqual([])
  })

  it('stamps no safety tier on plan items, actions or proposals', () => {
    const health = files.filter((file) => isHealthSurface(file.path) || /approvals/.test(file.path))
    expect(matches(/\bsafety:\s*['"](?:safe|manual|destructive)['"]/, health, LEGACY_SHAPE_ALLOWED)).toEqual([])
  })
})

describe('shared engine actions', () => {
  it('core registers every shared engine action before plugins activate', () => {
    const doctor = readFileSync(join(ROOT, 'src/core/doctor.ts'), 'utf8')
    const server = readFileSync(join(ROOT, 'server.ts'), 'utf8')
    expect([...SHARED_ENGINE_ACTIONS]).toEqual(['core.diagnose'])
    expect(doctor).toContain('registerCoreHealthRepairAction(diagnoseRepair(')
    expect(server.indexOf('ensureCoreRepairActions()')).toBeGreaterThan(-1)
    expect(server.indexOf('ensureCoreRepairActions()')).toBeLessThan(server.indexOf('pluginRegistry.initialize('))
  })
})

describe('re-homing table — every check declares its catalog', () => {
  const table = readFileSync(join(ROOT, '.claude/specs/self-healing-health-and-updates-2026-10-inventories/re-homing.md'), 'utf8')
  const rows = table.split('\n').filter((line) => /^\|\d+\|/.test(line))
  const checkIds = new Set<string>()
  for (const row of rows) {
    const cell = row.split('|')[2]!.trim()
    if (cell.startsWith('core:verification')) continue // core stamps those rows itself (owner subject + core.diagnose)
    // Two rows name two checks at once: "health.search-canary/engine-burn" and "pi.home / pi.agents-root".
    const parts = cell === 'health.search-canary/engine-burn'
      ? ['health.search-canary', 'health.search-engine-burn']
      : cell.includes(' / ') ? cell.split(' / ') : [cell]
    for (const part of parts) checkIds.add(part.trim())
  }

  /**
   * Every registration object in production code — `registerXHealthCheck({ … })`
   * or an adapter's `HealthCheckRegistrationInput[]` literal — keyed by local
   * id: `{ id: '<local>', name: … }` with an `incidents:` field in the same object.
   */
  const registered = new Map<string, boolean>()
  const production = files.filter((file) => !file.path.startsWith('tests/'))
  function declares(local: string): boolean | undefined {
    let seen: boolean | undefined
    const pattern = new RegExp(`\\bid:\\s*'${local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s*\\n\\s*name:`, 'g')
    for (const file of production) {
      for (const match of file.source.matchAll(pattern)) {
        const objectEnd = file.source.indexOf('\n    })', match.index)
        const body = file.source.slice(match.index, objectEnd === -1 ? match.index + 4000 : objectEnd)
        seen = (seen ?? false) || /\bincidents:/.test(body)
      }
    }
    return seen
  }
  for (const checkId of checkIds) {
    const local = checkId.includes('.') ? checkId.slice(checkId.indexOf('.') + 1) : checkId
    const verdict = declares(local)
    if (verdict !== undefined) registered.set(local, verdict)
  }

  it('parses the table into check ids', () => {
    expect(rows.length).toBe(206)
    expect(checkIds.size).toBeGreaterThan(40)
  })

  for (const checkId of [...checkIds].sort()) {
    const local = checkId.includes('.') ? checkId.slice(checkId.indexOf('.') + 1) : checkId
    it(`${checkId} registers an incidents catalog`, () => {
      expect(registered.has(local)).toBe(true)
      expect(registered.get(local)).toBe(true)
    })
  }
})
