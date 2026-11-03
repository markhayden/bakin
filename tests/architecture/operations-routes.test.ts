/**
 * The final route lists (#895 SPEC "Converted routes" + "Deliberate
 * synchronous exclusions", PLAN § 6.4): every long-running route answers 202
 * as an operation and declares the resource its writers take; the bounded
 * synchronous writers take theirs without waiting. Moving a route between
 * the lists is an ordinary reviewed change — edit this table with it.
 *
 * Pure scanner: reads source as text, imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const read = (file: string) => readFileSync(join(ROOT, file), 'utf-8')

/**
 * route file → where its operation is declared and the resource it owns.
 * `null`: the resource is not the route's (onboarding: each component
 * declares its own; health repair: each child action does).
 */
const CONVERTED: Record<string, { declaredIn: string; resource: string | null }> = {
  'packages/host/src/api/packages/install.ts': { declaredIn: 'packages/host/src/api/packages/install.ts', resource: 'install-state' },
  'packages/host/src/api/packages/dynamic.ts': { declaredIn: 'packages/host/src/api/packages/dynamic.ts', resource: 'install-state' },
  'packages/host/src/api/agent-packages/install.ts': { declaredIn: 'packages/host/src/api/agent-packages/install.ts', resource: 'install-state' },
  'packages/host/src/api/agent-packages/dynamic.ts': { declaredIn: 'packages/host/src/api/agent-packages/dynamic.ts', resource: 'install-state' },
  'packages/host/src/api/plugins/install.ts': { declaredIn: 'packages/host/src/api/plugins/install.ts', resource: 'install-state' },
  'packages/host/src/api/plugins/upgrade.ts': { declaredIn: 'packages/host/src/api/plugins/upgrade.ts', resource: 'install-state' },
  'packages/host/src/api/plugins/remove.ts': { declaredIn: 'packages/host/src/api/plugins/remove.ts', resource: 'install-state' },
  'packages/host/src/api/plugins/restore.ts': { declaredIn: 'packages/host/src/api/plugins/restore.ts', resource: 'install-state' },
  'packages/host/src/api/plugins/link.ts': { declaredIn: 'packages/host/src/api/plugins/link.ts', resource: 'install-state' },
  'packages/host/src/api/skills.ts': { declaredIn: 'packages/host/src/api/skills.ts', resource: 'install-state' },
  'packages/host/src/api/search/maintenance.ts': { declaredIn: 'src/core/search-operations.ts', resource: 'search-engine' },
  'packages/host/src/api/runtime/switch.ts': { declaredIn: 'src/core/runtime-switch.ts', resource: 'install-state' },
  'packages/host/src/api/runtime/onboarding.ts': { declaredIn: 'src/core/onboarding/operation.ts', resource: null },
  // #1007 D7.4: the apply service starts the subject's own operation (plugin
  // upgrade → install-state, engine reinstall → search-engine through the
  // repair reindex, models install) or resolves a covering approval.
  'packages/host/src/api/updates.ts': { declaredIn: 'src/core/updates/apply.ts', resource: 'search-engine' },
}

/** Plugin routes that start operations through `ctx.operations` / the doctor. */
const CONVERTED_PLUGIN_ROUTES: Record<string, string | null> = {
  'plugins/team/lib/routes/teams.ts': 'install-state',
  'plugins/health/index.ts': null,
}

/** Bounded synchronous writers: the resource they take without waiting (409 when busy). */
const NON_BLOCKING_WRITERS: Record<string, string> = {
  'src/core/agent-packages/lesson-toggle.ts': 'install-state',
  'packages/host/src/api/plugins/unlink.ts': 'install-state',
  'packages/host/src/api/plugins/enable-toggle.ts': 'install-state',
  'packages/host/src/api/skills.ts': 'install-state',
}

// `confirmApply(`: the Updates apply service (#1007 D7.4) starts the subject's operation on the route's behalf.
const STARTS_OPERATION = /startOperationResponse[<(]|operations\.start[<(]|startDoctorRepair\(|confirmApply\(/

function* routeFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* routeFiles(full)
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) yield relative(ROOT, full)
  }
}

describe('converted routes (#895 final list)', () => {
  it.each(Object.entries(CONVERTED))('%s starts an operation declaring its resource', (route, { declaredIn, resource }) => {
    expect(STARTS_OPERATION.test(read(route))).toBe(true)
    if (resource) expect(read(declaredIn)).toMatch(new RegExp(`resources:[^\\n]*'${resource}'`))
  })

  it.each(Object.entries(CONVERTED_PLUGIN_ROUTES))('%s starts operations', (route, resource) => {
    expect(STARTS_OPERATION.test(read(route))).toBe(true)
    if (resource) expect(read(route)).toMatch(new RegExp(`resources:[^\\n]*'${resource}'`))
  })

  it('every host API route that starts an operation is on the list', () => {
    const unlisted = [...routeFiles(join(ROOT, 'packages/host/src/api'))]
      .filter((file) => file !== 'packages/host/src/api/operations.ts')
      .filter((file) => STARTS_OPERATION.test(read(file)) && !(file in CONVERTED))
    expect(unlisted).toEqual([])
  })
})

describe('bounded synchronous writers', () => {
  it.each(Object.entries(NON_BLOCKING_WRITERS))('%s takes %s without waiting', (file, resource) => {
    expect(read(file)).toMatch(new RegExp(`holdNow\\(\\s*\\[\\s*'${resource}'\\s*\\]`))
  })
})
