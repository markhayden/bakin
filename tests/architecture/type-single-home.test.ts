/**
 * Architecture scan guarding the contract types against re-forking.
 *
 * WS1 (audit 2026-06) collapsed the plugin-contract types to single homes —
 * or, for the deliberate two-tier pairs (SDK published projection vs core/
 * storage full shape), to exactly two. Until now only header comments
 * enforced that; the one unguarded copy (plugins/tasks/types.ts Task) had
 * already drifted (missing `version`). This scan pins every guarded name's
 * EXPORTED declarations to its sanctioned files, so a new fork fails CI.
 *
 * Local, non-exported declarations (e.g. `interface WorkflowInstance extends
 * SdkWorkflowInstance` inside a component) are file-scoped and deliberately
 * NOT flagged — they cannot cause cross-module drift.
 *
 * Pure scanner: walks the source tree as text, imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()

/** Guarded name → the only files allowed to EXPORT a declaration of it. */
const SANCTIONED_HOMES: Record<string, string[]> = {
  // Deliberate two-tier pairs (SDK published projection + internal full shape)
  PluginContext: ['packages/sdk/src/types/context.ts', 'packages/core/src/plugin-types.ts'],
  BakinPlugin: ['packages/sdk/src/types/context.ts', 'packages/core/src/plugin-types.ts'],
  ExecToolDefinition: ['packages/sdk/src/types/registration.ts', 'packages/core/src/plugin-types.ts'],
  Task: ['packages/sdk/src/types/services.ts', 'src/core/task-store.ts'],
  TaskSource: ['packages/sdk/src/types/services.ts', 'packages/core/src/tasks/store.ts'],
  WorkflowInstance: ['packages/sdk/src/types/registration.ts', 'plugins/workflows/types.ts'],
  WorkflowDefinition: ['packages/sdk/src/types/registration.ts', 'packages/core/src/workflows/definition-types.ts'],
  // Single-homed (SDK is the one source; everything else re-exports)
  TaskLogEntry: ['packages/sdk/src/types/services.ts'],
  HealthCheckRunInput: ['packages/sdk/src/types/health.ts'],
  HealthCheckRegistrationInput: ['packages/sdk/src/types/health.ts'],
  HealthRepairActionDefinition: ['packages/sdk/src/types/health.ts'],
  HealthRepairPlan: ['packages/sdk/src/types/health.ts'],
  HealthObservation: ['packages/sdk/src/types/health.ts'],
  HealthIncident: ['packages/sdk/src/types/health.ts'],
  HealthReport: ['packages/sdk/src/types/health.ts'],
  AvailableModel: ['packages/sdk/src/types/services.ts'],
  AgentUsage: ['packages/sdk/src/types/services.ts'],
  PluginManifest: ['packages/sdk/src/types/manifest.ts'],
}

const SCAN_ROOTS = [
  'packages/sdk/src', 'packages/core/src', 'packages/host/src',
  'packages/adapter-openclaw/src', 'packages/adapter-antfly/src',
  'plugins', 'src', 'cli', 'scripts',
]
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}

describe('contract types stay in their sanctioned homes', () => {
  const names = Object.keys(SANCTIONED_HOMES)
  const pattern = new RegExp(
    `^\\s*export\\s+(?:declare\\s+)?(?:interface|type)\\s+(${names.join('|')})\\b[^.\\w]`,
    'gm',
  )

  const declarations = new Map<string, string[]>()
  for (const root of SCAN_ROOTS) {
    for (const file of walk(join(ROOT, root))) {
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(pattern)) {
        const name = m[1]
        const rel = relative(ROOT, file)
        declarations.set(name, [...(declarations.get(name) ?? []), rel])
      }
    }
  }

  for (const [name, homes] of Object.entries(SANCTIONED_HOMES)) {
    it(`${name} is declared only in: ${homes.join(', ')}`, () => {
      const found = declarations.get(name) ?? []
      const rogue = found.filter((f) => !homes.includes(f))
      expect(rogue).toEqual([])
      // The sanctioned homes must actually declare it — a silent rename would
      // otherwise leave this scan asserting against nothing.
      for (const home of homes) {
        expect(found).toContain(home)
      }
    })
  }
})
