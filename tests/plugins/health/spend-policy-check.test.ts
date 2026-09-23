/**
 * spend.policy-available (health-owned, D26/S13): names the state in which
 * the dispatch gate fails closed because the spend plugin's policy hook is
 * absent or unanswering — the spend plugin cannot report its own activation
 * failure, so the health plugin does.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-spend-policy-check-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { getHookRegistry } from '../../../packages/core/src/hooks/hook-registry-singleton'
import { checkSpendPolicyAvailable } from '../../../plugins/health/lib/system-checks/spend-policy'

const registry = getHookRegistry()
afterEach(() => registry.unregisterByPlugin('test-spend'))

function observations(input: Awaited<ReturnType<typeof checkSpendPolicyAvailable>>) {
  return (input as { observations: Array<{ status: string; summary: string; incident?: { key: string; class?: string; disposition: string } }> }).observations
}

describe('spend.policy-available', () => {
  it('is an action-required service failure when the hook is not registered (the gate is failing closed)', async () => {
    const [row] = observations(await checkSpendPolicyAvailable())
    expect(row.status).toBe('error')
    expect(row.incident).toMatchObject({ key: 'policy-unavailable', class: 'service_failure', disposition: 'action_required' })
  })

  it('is healthy when the hook answers, reporting the limit count', async () => {
    registry.register('spend.getBudgetPolicy', () => ({ rules: [{ id: 'a' }, { id: 'b' }] }), { pluginId: 'test-spend' } as never)
    const [row] = observations(await checkSpendPolicyAvailable())
    expect(row.status).toBe('healthy')
    expect(row.summary).toContain('2 limits')
  })

  it('an INVALID spend.json (the plugin refuses to read it) is action required, naming the file and its issues', async () => {
    registry.register('spend.getBudgetPolicy', () => {
      throw Object.assign(new Error('/x/spend.json is not a valid spend policy'), { code: 'spend_settings_invalid', file: '/x/spend.json', issues: ['limits.rules.0.dailyCap: Expected number'] })
    }, { pluginId: 'test-spend' } as never)
    const [row] = observations(await checkSpendPolicyAvailable())
    expect(row.status).toBe('error')
    expect(row.incident).toMatchObject({ key: 'policy-invalid', class: 'service_failure', disposition: 'action_required' })
    expect(JSON.stringify(row)).toContain('/x/spend.json')
    expect(JSON.stringify(row)).toContain('dailyCap')
  })

  it('is unknown (watch) when the hook throws — never healthy on a failed read', async () => {
    registry.register('spend.getBudgetPolicy', () => { throw new Error('settings unreadable') }, { pluginId: 'test-spend' } as never)
    const [row] = observations(await checkSpendPolicyAvailable())
    expect(row.status).toBe('unknown')
    expect(row.incident).toMatchObject({ key: 'policy-unanswered', disposition: 'watch' })
  })
})
