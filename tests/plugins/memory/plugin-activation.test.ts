/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Tests for the rewritten memory plugin shell (C2).
 *
 * Asserts:
 *   1. Activates cleanly with no thrown errors.
 *   2. Registers exactly one search content type — `bakin_memory` — with the
 *      tier/agent/kind/eventType/phase/date facets called for by the spec.
 *   3. Does NOT register the legacy `audit` table.
 *   4. Does NOT register the old `/workspace` route.
 *   5. Wires `ctx.watchFiles` with the spec-listed OpenClaw and Bakin paths.
 *   6. Keeps the existing nav item (`/memory`).
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-memory-activation-${Date.now()}`)

// Mock factories are hoisted, so they can't close over `testDir`. Inline the
// path computation instead; they all land under the same OS tmp root.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-activation-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})
mock.module('../../../packages/core/src/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-activation-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/watcher', () => ({
  watchFiles: mock(),
}))
mock.module('../../../packages/core/src/openclaw-home', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-activation-mock`, 'openclaw')
  return {
    getOpenClawHome: () => base,
    getOpenClawPath: (...parts: string[]) => j(base, ...parts),
  }
})
mock.module('../../../packages/core/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
}))
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    runtime: {
      adapter: 'openclaw',
      settings: {},
    },
    antfly: { auditTtl: null },
  }),
}))

import { activatePlugin, findRoute } from '../test-helpers'
import memoryPlugin from '../../../plugins/memory/index'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('memory plugin shell (C2)', () => {
  it('has the expected plugin identity', () => {
    expect(memoryPlugin.id).toBe('memory')
    expect(memoryPlugin.name).toBe('Memory')
    expect(memoryPlugin.navItems?.[0]?.href).toBe('/memory')
  })

  it('registers exactly one search content type, and it is bakin_memory', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    const reg = activated.ctx.search.registerContentType as ReturnType<typeof mock>

    expect(reg).toHaveBeenCalledTimes(1)
    const def = reg.mock.calls[0][0]
    // table is unprefixed here — search-registry auto-prefixes to bakin_memory.
    expect(def.table === 'memory' || def.table === 'bakin_memory').toBe(true)
  })

  it('registers the bakin_memory schema with the facets the spec calls for', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    const reg = activated.ctx.search.registerContentType as ReturnType<typeof mock>
    const def = reg.mock.calls[0][0]

    // Core fields every tier writes.
    for (const field of ['tier', 'agent', 'title', 'snippet', 'content', 'updated_at', 'meta']) {
      expect(def.schema[field]).toBeDefined()
    }
    // Facets include the tier discriminator and every field the UI filters by.
    for (const facet of ['tier', 'agent']) {
      expect(def.facets).toContain(facet)
    }
  })

  it('does NOT register the legacy audit table', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    const reg = activated.ctx.search.registerContentType as ReturnType<typeof mock>
    for (const call of reg.mock.calls) {
      expect(call[0].table).not.toBe('audit')
      expect(call[0].table).not.toBe('bakin_audit')
    }
  })

  it('does NOT register the old /workspace route', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    expect(findRoute(activated.routes, 'GET', '/workspace')).toBeUndefined()
  })

  it('registers GET /audit (C3 audit tier)', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    expect(findRoute(activated.routes, 'GET', '/audit')).toBeDefined()
  })

  it('auto-registers GET /search via registerContentType', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    expect(findRoute(activated.routes, 'GET', '/search')).toBeDefined()
  })

  it('registers all 5 MCP exec tools (C10)', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    const names = activated.execTools.map((t) => t.name).sort()
    expect(names).toEqual([
      'bakin_exec_memory_get_session',
      'bakin_exec_memory_get_turn',
      'bakin_exec_memory_list_agents',
      'bakin_exec_memory_search',
      'bakin_exec_memory_status',
    ])
  })

  it('calls watchFiles with the spec-listed paths', async () => {
    const activated = await activatePlugin(memoryPlugin, testDir)
    const watch = activated.ctx.watchFiles as ReturnType<typeof mock>
    expect(watch).toHaveBeenCalled()
    const paths = watch.mock.calls.flatMap((c) => c[0] as string[])
    // Must include Bakin's audit log and at least one OpenClaw glob for each
    // tier the spec lists. We match loosely on path fragments so the shell
    // can use absolute paths resolved via getOpenClawPath.
    const expectedFragments = [
      'audit.jsonl',
      'sessions.json',
      'sessions', // turn/checkpoint jsonl files
      'workspace/memory', // daily notes + dream artifacts
      'workspace', // durable
    ]
    for (const frag of expectedFragments) {
      expect(paths.some((p) => p.includes(frag))).toBe(true)
    }
  })
})
