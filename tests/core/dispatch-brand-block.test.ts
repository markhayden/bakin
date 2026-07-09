/**
 * Effective-brand resolution + dispatch brand block (#419, spec §4/§5).
 *
 * Chain: task.brandId → cycle-safe parentId ancestry → projects.getBrand
 * hook (own or inherited projectId). The block builder returns `none` for
 * unbranded tasks, `ready` with injection-record meta, and `missing` when a
 * linked brand doesn't resolve — fail closed, never a fabricated card.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-brand-block-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: () => ({ dispatch: { maxBrandContextBytes: 12288 } }),
}))
mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../src/core/agent-packages/lesson-retrieval', () => ({
  formatLessonsForDispatch: () => '',
  retrieveAgentPackageLessons: mock().mockResolvedValue([]),
}))
mock.module('../../src/core/dispatch-failures', () => ({
  formatDispatchError: (e: unknown) => String(e),
}))

// Task-store ancestry fixture — resolveEffectiveBrandId imports getTask lazily.
const tasksById = new Map<string, { id: string; brandId?: string; parentId?: string | null; projectId?: string }>()
mock.module('../../src/core/task-store', () => ({
  getTask: (id: string) => tasksById.get(id) ?? null,
}))

// Hook registry fixture.
const hookHandlers = new Map<string, (data: unknown) => unknown>()
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    has: (name: string) => hookHandlers.has(name),
    invoke: async (name: string, data: unknown) => hookHandlers.get(name)?.(data),
    register: mock(),
  }),
}))

import {
  resolveEffectiveBrand,
  buildDispatchBrandBlock,
  deferForMissingBrand,
  __resetBrandBlockNotifications,
} from '../../src/core/dispatch-context-blocks'
import { appendAudit } from '../../src/core/audit'

beforeEach(() => {
  tasksById.clear()
  hookHandlers.clear()
  __resetBrandBlockNotifications()
  ;(appendAudit as ReturnType<typeof mock>).mockClear()
})

describe('resolveEffectiveBrand', () => {
  it('own brandId always wins', async () => {
    expect(await resolveEffectiveBrand({ id: 't1', brandId: 'acme', projectId: 'p1' })).toEqual({ brandId: 'acme', source: 'own' })
  })

  it('walks the parent ancestry (decomposition subtasks inherit)', async () => {
    tasksById.set('parent', { id: 'parent', parentId: 'grand' })
    tasksById.set('grand', { id: 'grand', brandId: 'acme' })
    expect(await resolveEffectiveBrand({ id: 't1', parentId: 'parent' })).toEqual({ brandId: 'acme', source: 'parent' })
  })

  it('is cycle-safe on corrupt parent chains', async () => {
    tasksById.set('a', { id: 'a', parentId: 'b' })
    tasksById.set('b', { id: 'b', parentId: 'a' })
    expect(await resolveEffectiveBrand({ id: 'a', parentId: 'b' })).toBeUndefined()
  })

  it('falls back to the project brand via the hook (own or inherited projectId)', async () => {
    hookHandlers.set('projects.getBrand', (data) => ((data as { projectId: string }).projectId === 'p1' ? 'acme' : undefined))
    expect(await resolveEffectiveBrand({ id: 't1', projectId: 'p1' })).toEqual({ brandId: 'acme', source: 'project' })

    // Inherited projectId from an ancestor
    tasksById.set('parent', { id: 'parent', projectId: 'p1' })
    expect(await resolveEffectiveBrand({ id: 't2', parentId: 'parent' })).toEqual({ brandId: 'acme', source: 'project' })
  })

  it('fails CLOSED (unresolved) when the project hook throws — never silently unbranded', async () => {
    hookHandlers.set('projects.getBrand', () => { throw new Error('hook boom') })
    expect(await resolveEffectiveBrand({ id: 't1', projectId: 'p1' })).toEqual({ unresolved: true, projectId: 'p1' })
    // A branded workflow/task on this outcome must defer, not dispatch brandless:
    expect(await deferForMissingBrand({ id: 't1', title: 'x', projectId: 'p1' }, '/tmp/x')).toEqual({ brandId: 'project:p1' })
  })

  it('returns undefined for unbranded tasks and when the hook is absent', async () => {
    expect(await resolveEffectiveBrand({ id: 't1' })).toBeUndefined()
    expect(await resolveEffectiveBrand({ id: 't2', projectId: 'p1' })).toBeUndefined()
  })
})

describe('buildDispatchBrandBlock', () => {
  it('returns none for unbranded tasks without invoking brands', async () => {
    expect(await buildDispatchBrandBlock({ id: 't1' })).toEqual({ status: 'none' })
  })

  it('returns ready with card + meta from brands.getContext', async () => {
    hookHandlers.set('brands.getContext', (data) => {
      expect((data as { brandId: string }).brandId).toBe('acme')
      expect((data as { maxBytes: number }).maxBytes).toBe(12288)
      return {
        card: '## Brand: Acme (acme)',
        warnings: [],
        meta: { brandId: 'acme', brandFingerprint: 'sha256:x', cardBytes: 21, sectionsIncluded: [], lessonsIncluded: [], omitted: [] },
      }
    })
    const result = await buildDispatchBrandBlock({ id: 't1', brandId: 'acme' })
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.block).toContain('Acme')
      expect(result.meta.brandFingerprint).toBe('sha256:x')
    }
  })

  it('defer gate: unbranded passes, published passes, missing/draft defers with notify-once', async () => {
    const task = { id: 't1', title: 'Launch tweet', brandId: 'acme' }

    // Unbranded → never defers
    expect(await deferForMissingBrand({ id: 'plain', title: 'Plain' }, '/tmp/x')).toBe(false)

    // Missing brand (hook absent) → defers + audits ONCE across cycles
    expect(await deferForMissingBrand(task, '/tmp/x')).toEqual({ brandId: 'acme' })
    expect(await deferForMissingBrand(task, '/tmp/x')).toEqual({ brandId: 'acme' })
    const auditCalls = (appendAudit as ReturnType<typeof mock>).mock.calls.filter((c: unknown[]) => c[1] === 'brand.dispatch_blocked')
    expect(auditCalls.length).toBe(1)

    // Brand restored → passes and clears the incident
    hookHandlers.set('brands.get', () => ({ manifest: { id: 'acme' } }))
    expect(await deferForMissingBrand(task, '/tmp/x')).toBe(false)

    // Draft brands defer too
    hookHandlers.set('brands.get', () => ({ manifest: { id: 'acme', draft: true } }))
    expect(await deferForMissingBrand(task, '/tmp/x')).toEqual({ brandId: 'acme' })
    // ...and the cleared incident re-notifies (second deletion is a new event)
    const again = (appendAudit as ReturnType<typeof mock>).mock.calls.filter((c: unknown[]) => c[1] === 'brand.dispatch_blocked')
    expect(again.length).toBe(2)
  })

  it('fails closed: missing when the brand is notFound, the hook is absent, or it throws', async () => {
    expect(await buildDispatchBrandBlock({ id: 't1', brandId: 'ghost' })).toEqual({ status: 'missing', brandId: 'ghost' })

    hookHandlers.set('brands.getContext', () => ({ notFound: true }))
    expect(await buildDispatchBrandBlock({ id: 't1', brandId: 'ghost' })).toEqual({ status: 'missing', brandId: 'ghost' })

    hookHandlers.set('brands.getContext', () => {
      throw new Error('boom')
    })
    expect(await buildDispatchBrandBlock({ id: 't1', brandId: 'acme' })).toEqual({ status: 'missing', brandId: 'acme' })
  })
})
