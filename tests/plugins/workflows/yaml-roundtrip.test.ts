/**
 * YAML round-trip test for every workflow shipped by the core plugins.
 *
 * For each YAML file under `plugins/* /defaults/workflows/*.yaml`:
 *   1. Load it from disk.
 *   2. Parse it via `workflowDefinitionSchema` — the schema used by the
 *      REST writer. Fails the suite if any shipped workflow no longer
 *      validates against the schema-of-record.
 *   3. Serialize the parsed definition back through `yaml.dump` — the
 *      exact writer the canvas editor's save path hits via the REST
 *      route — and confirm it re-parses identically. That guarantees
 *      the canvas editor cannot silently drop fields when a user opens
 *      and re-saves a shipped workflow.
 */

import { describe, expect, it, mock } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import yaml from 'js-yaml'

const testDir = join(tmpdir(), `bakin-test-yaml-roundtrip-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('@/core/task-store', () => ({
  createTask: mock(),
  addTaskLog: mock(),
  moveTask: mock(),
  readTaskboard: mock(() => ({ columns: {} })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

import { workflowDefinitionSchema } from '../../../plugins/workflows/lib/node-type-registry'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const PLUGINS_DIR = join(REPO_ROOT, 'plugins')

function discoverShippedWorkflows(): string[] {
  const results: string[] = []
  for (const entry of readdirSync(PLUGINS_DIR)) {
    const defaultsDir = join(PLUGINS_DIR, entry, 'defaults', 'workflows')
    try {
      const stat = statSync(defaultsDir)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }
    for (const file of readdirSync(defaultsDir)) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        results.push(join(defaultsDir, file))
      }
    }
  }
  return results
}

const files = discoverShippedWorkflows()

describe('live workflow YAML round-trip', () => {
  it('discovers at least one shipped workflow', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('preserves YAML-backed fields outside the editor-owned field set', () => {
    const parsed = workflowDefinitionSchema.safeParse({
      name: 'Round Trip',
      description: 'Synthetic preserve-set fixture',
      version: 1,
      metadata: { owner: 'roundtrip-test' },
      triggers: [{ type: 'manual', enabled: true }],
      inputs: {
        topic: {
          type: 'string',
          description: 'Subject',
          ui: { widget: 'longtext' },
        },
      },
      steps: [
        {
          id: 'write',
          type: 'agent',
          label: 'Write',
          agent: 'chef',
          output_schema: { type: 'object' },
          plugin_config: { keep: true },
        },
      ],
      layout: {
        positions: { write: { x: 1, y: 2 } },
        viewport: { x: 10, y: 20, zoom: 0.8 },
      },
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect((parsed.data as Record<string, unknown>).metadata).toEqual({ owner: 'roundtrip-test' })
    expect((parsed.data as Record<string, unknown>).triggers).toEqual([{ type: 'manual', enabled: true }])
    expect((parsed.data.inputs?.topic as Record<string, unknown>).ui).toEqual({ widget: 'longtext' })
    expect((parsed.data.steps[0] as Record<string, unknown>).output_schema).toEqual({ type: 'object' })
    expect((parsed.data.steps[0] as Record<string, unknown>).plugin_config).toEqual({ keep: true })
    expect((parsed.data.layout as Record<string, unknown>).viewport).toEqual({ x: 10, y: 20, zoom: 0.8 })
  })

  for (const file of files) {
    const relPath = file.slice(REPO_ROOT.length + 1)

    it(`validates and round-trips ${relPath}`, () => {
      const raw = readFileSync(file, 'utf-8')
      const parsed = yaml.load(raw) as unknown

      const result = workflowDefinitionSchema.safeParse(parsed)
      expect(
        result.success,
        result.success
          ? undefined
          : `${relPath} failed schema validation:\n${JSON.stringify(result.error.issues, null, 2)}`,
      ).toBe(true)
      if (!result.success) return

      // Re-dump and re-parse — must produce an equivalent object.
      const dumped = yaml.dump(result.data)
      const reparsed = yaml.load(dumped) as unknown
      const reValidated = workflowDefinitionSchema.safeParse(reparsed)
      expect(reValidated.success).toBe(true)
      if (!reValidated.success) return

      expect(reValidated.data).toEqual(result.data)
    })
  }
})
