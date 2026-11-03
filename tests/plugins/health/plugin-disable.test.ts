/**
 * Row 98 (self-healing PR1, Codex r1 #10): an upstream-blocked plugin
 * artifact is the operator's decision ON THE CARD — "Disable plugin" is a
 * request choice beside the Explore link; `required` is the two facts the
 * owner can read (the ledger's `disabled` mark, declared contributions /
 * installed skills); a disabled plugin's stale artifact is an observation.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-plugin-disable-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}), isUsingBakinHome: () => true })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

import type { HealthCheckRunInput, UpdateRecord } from '@makinbakin/sdk'
import { checkPluginArtifacts, pluginUsage, type PluginArtifactDeps, type PluginConsumers } from '../../../plugins/health/lib/system-checks/plugin-artifacts'
import { writeProvenance, WHISKIT_PROVENANCE_VERSION, type WhiskitBuildProvenance } from '../../../src/core/whiskit/provenance'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

function observed(run: HealthCheckRunInput) {
  const parsed = parseHealthCheckRunInput(run)
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

/** A stranded (needs-update) artifact: provenance built against another externals contract. */
function installStranded(id: string, manifest: Record<string, unknown> = {}): string {
  const dir = join(testDir, 'plugins', id)
  mkdirSync(join(dir, '.whiskit'), { recursive: true })
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({ id, version: '1.0.0', ...manifest }))
  const prov: WhiskitBuildProvenance = {
    version: WHISKIT_PROVENANCE_VERSION,
    pluginId: id,
    pluginVersion: '1.0.0',
    bakinVersion: '0.0.1-rc.15',
    bakinRange: '>=0.0.1-rc.1',
    whiskitVersion: '1',
    buildBackend: 'system-bun',
    platform: 'neutral',
    sourceCommitSha: '',
    sourceTreeSha: 'a'.repeat(64),
    manifestSha: 'b'.repeat(64),
    externalsContract: 'react18-old-vX',
    approvedInstallScripts: [],
    outputs: { serverEntry: 'dist/index.js' },
    builtAt: '2026-06-04T00:00:00.000Z',
  }
  writeProvenance(join(dir, '.whiskit', 'build.json'), prov)
  return dir
}

function lockEntry(id: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(join(testDir, 'plugins', 'lock.json'), JSON.stringify({
    version: 1,
    plugins: {
      [id]: {
        source: `github:markhayden/bakin-bits-official#plugins/${id}`,
        type: 'github', ref: '', commitSha: '',
        installedAt: '2026-10-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'c'.repeat(64),
        ...extra,
      },
    },
  }))
}

const blockedRecord = async (): Promise<UpdateRecord> => ({
    id: 'plugin:stale', kind: 'plugin', outcome: 'blocked', blockedReason: 'no published release of stale runs on this Bakin yet (newest is 2.0.0)',
    action: 'manual', group: 'available', subject: { kind: 'plugin', id: 'stale', label: 'stale' },
    source: { kind: 'artifact-index', endpoint: 'https://example.test/index.json' }, fingerprint: 'fp',
    observedAt: '2026-10-19T12:00:00.000Z', attempt: { at: '2026-10-19T12:00:00.000Z' },
  } as unknown as UpdateRecord)
/** Row 98's usage FACT is injected: live consumers (open tasks it created, workflow runs on its definitions), or `null` = unreadable. */
const nobody = { openTasks: [], runningWorkflows: [] }
const withConsumers = (consumers: PluginConsumers | null): PluginArtifactDeps => ({ record: blockedRecord, consumers: async () => consumers })
const blocked = withConsumers(nobody)

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
  mkdirSync(join(testDir, 'plugins'), { recursive: true })
})

describe('row 98 — upstream-blocked plugin artifact', () => {
  it('an enabled plugin with a LIVE consumer (an open task it created): a required decision on its Explore card, with "Disable plugin" as a confirmed, effect-declared request choice', async () => {
    installStranded('stale', { contributes: { navItems: [{ label: 'Stale', path: '/stale' }], execTools: [{ name: 'bakin_exec_stale_do' }] } })
    lockEntry('stale')
    const [row] = observed(await checkPluginArtifacts(withConsumers({ openTasks: ['t-1', 't-2'], runningWorkflows: [] })))
    expect(row.incident).toMatchObject({ declarationId: 'needs-update-blocked', required: true, disposition: 'action_required' })
    expect(row.incident?.impact).toContain('In use now: 2 open task(s) it created (t-1, t-2)')
    expect(row.incident?.resolution).toMatchObject({ type: 'human', needs: 'decision', href: '/explore?tab=plugins&item=plugin:stale' })
    const choices = row.incident?.resolution.choices ?? []
    expect(choices.map((choice) => choice.key)).toEqual(['disable-plugin', 'updates'])
    expect(choices[0]).toMatchObject({ kind: 'request', method: 'POST', url: '/api/plugins/disable', body: { pluginId: 'stale' }, tone: 'danger', effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false }, confirm: { title: 'Disable stale?' } })
    const description = (choices[0] as { confirm: { description: string } }).confirm.description
    expect(description).toContain('1 declared navItems, 1 declared execTools')
    expect(description).toContain('2 open task(s) it created')
    expect(choices[1]).toMatchObject({ kind: 'link', href: '/health?tab=updates' })
  })

  it('declared contributions and installed skills are what disabling takes away, NOT usage: with no consumer the plugin is advisory (Codex r2 / r1 #11)', async () => {
    installStranded('stale', { contributes: { navItems: [{ label: 'Stale', path: '/stale' }] } })
    lockEntry('stale', { installedSkills: ['ocr'] })
    const [row] = observed(await checkPluginArtifacts(blocked))
    expect(row.incident).toMatchObject({ declarationId: 'needs-update-blocked', required: false, disposition: 'advisory' })
    expect(row.incident?.impact).toContain('Nothing is using it right now')
    expect(row.incident?.resolution.choices?.[0]).toMatchObject({ key: 'disable-plugin' })
    expect(await pluginUsage('stale', join(testDir, 'plugins', 'stale'), async () => nobody)).toEqual({
      disabled: false, referenced: false, referencedBy: [], declares: ['1 declared navItems', '1 installed runtime skill(s)'], usageKnown: true,
    })
  })

  it('a workflow run in progress on one of its definitions is a consumer; an unreadable consumer fact is advisory with the gap named, never "in use"', async () => {
    installStranded('stale')
    lockEntry('stale')
    const running = await pluginUsage('stale', join(testDir, 'plugins', 'stale'), async () => ({ openTasks: [], runningWorkflows: ['wf-task-9'] }))
    expect(running).toMatchObject({ referenced: true, referencedBy: ['1 workflow run(s) in progress on its definitions'], usageKnown: true })
    const [row] = observed(await checkPluginArtifacts(withConsumers(null)))
    expect(row.incident).toMatchObject({ required: false, disposition: 'advisory' })
    expect(row.incident?.impact).toContain('could not be read, so it is listed as advisory')
  })

  it('a DISABLED plugin\'s stale artifact is a plain observation — nothing loads it, no card', async () => {
    installStranded('stale', { contributes: { navItems: [{ label: 'Stale', path: '/stale' }] } })
    lockEntry('stale', { disabled: true })
    const [row] = observed(await checkPluginArtifacts(blocked))
    expect(row.status).toBe('warning')
    expect(row.incident).toBeUndefined()
    expect(row.summary).toBe('stale is disabled; its artifact still needs a compatible update.')
    expect(row.evidence).toMatchObject({ disabled: true, verificationStatus: 'needs-update' })
  })
})
