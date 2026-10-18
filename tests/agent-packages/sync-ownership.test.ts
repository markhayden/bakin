/**
 * Sync-engine ownership (#895, PLAN 4.2): the engine no longer takes the
 * install lock itself — every writing sync must run inside an owner of
 * install-state. The two callers whose own operation switches land later
 * (onboarding's agent-sync component → PR6.2, the runtime switch → PR6.3)
 * own it through a local operation; each drives a REAL sync here and passes
 * the engine's inner ownership assertion. The teeth: the same sync without
 * an owner is refused.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-sync-owner-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createMockRuntimeAdapter } from '../../packages/core/src/adapters/runtime/testing'
import type { WorkspaceFile } from '../../packages/core/src/adapters/runtime'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

type TestGlobal = typeof globalThis & {
  __bakinAppServices?: { runtime: ReturnType<typeof createMockRuntimeAdapter> }
}

function installRuntimeMock(): void {
  const runtime = createMockRuntimeAdapter({ name: 'owner-test-runtime', version: '0.0.0', requiredCoreVersion: '*' })
  ;(globalThis as TestGlobal).__bakinAppServices = {
    runtime: {
      ...runtime,
      agents: {
        ...runtime.agents,
        readWorkspaceFile: async (agentId: string, path: string): Promise<WorkspaceFile | null> => {
          const file = join(openClawDir, 'workspaces', agentId, path)
          try {
            return { path, content: readFileSync(file, 'utf-8'), updatedAt: statSync(file).mtime.toISOString(), metadata: { userEdited: false } }
          } catch {
            return null
          }
        },
        writeWorkspaceFile: async (agentId: string, file: WorkspaceFile) => {
          const dir = join(openClawDir, 'workspaces', agentId)
          mkdirSync(dir, { recursive: true })
          writeFileSync(join(dir, file.path), file.content, 'utf-8')
        },
      },
    },
  }
}

import { installPackage as installPackageUnowned } from '../../src/core/agent-packages/installer'
import { owned } from '../helpers/owning'

/** Test setup installs as an owner of install-state, like every production caller (#895). */
const installPackage = owned(installPackageUnowned)
import { syncAllAgents } from '../../src/core/agent-packages/sync'
import { scanAgentSync } from '../../src/core/agent-packages/sync-scanner'
import { agentSyncComponent } from '../../src/core/onboarding/agent-sync'
import { syncAgentsIfDrifted } from '../../src/core/runtime-switch'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'

/** An installed agent package whose blocks lag the (lazily seeded) context layers — real drift. */
async function seedDriftedAgent(): Promise<void> {
  const dir = join(testDir, 'pixel-pkg')
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({
    id: 'pixel', kind: 'agent', name: 'pixel', version: '0.1.0',
    agent: { identity: { name: 'pixel' } },
    install: { writeWorkspaceFiles: true },
    contributions: { workspaceFiles: ['workspace/SOUL.md'] },
  }))
  writeFileSync(join(dir, 'workspace', 'SOUL.md'), '# Soul pixel\n')
  await installPackage({ source: dir })
  mkdirSync(join(testDir, 'team', 'context'), { recursive: true })
  writeFileSync(join(testDir, 'team', 'context', 'global.md'), '# House rules\n\n- Owned syncs only.\n')
  expect((await scanAgentSync()).findings.length).toBeGreaterThan(0)
}

afterAll(() => {
  _resetOperationRegistryForTests()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  _resetOperationRegistryForTests()
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(openClawDir, { recursive: true })
  installRuntimeMock()
})

const ranAs = (kind: string) => getOperationRegistry().list().find((view) => view.kind === kind)

describe('sync ownership', () => {
  it('a writing sync with no install-state owner is refused (the assertion has teeth)', async () => {
    await seedDriftedAgent()
    const results = await syncAllAgents({ fetch: false, trigger: 'system' })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => /requires install-state/.test(r.error ?? ''))).toBe(true)
  })

  it("onboarding's agent-sync component runs a real sync inside its operation, which owns install-state", async () => {
    await seedDriftedAgent()
    const { componentInstallOperation } = await import('../../src/core/onboarding/operation')
    const { operationId } = await getOperationRegistry().start(componentInstallOperation(agentSyncComponent, { autoApprove: true, allowServiceClaim: false }, 'cli'))
    const view = await getOperationRegistry().await(operationId)
    expect((view.result?.body as { result: { status: string } }).result.status).toBe('installed')
    expect((await scanAgentSync()).findings).toEqual([])
    const owner = ranAs('onboarding:agent-sync')
    expect(owner?.status).toBe('succeeded')
    expect(owner?.resources).toEqual(['install-state'])
  })

  it("the runtime switch's sync step runs a real sync inside a local operation that owns install-state", async () => {
    await seedDriftedAgent()
    const outcome = await syncAgentsIfDrifted()
    expect(outcome.drifted).toBe(true)
    expect(outcome.syncedAgents).toBeGreaterThan(0)
    expect((await scanAgentSync()).findings).toEqual([])
    const owner = ranAs('runtime-switch:sync')
    expect(owner?.status).toBe('succeeded')
    expect(owner?.resources).toEqual(['install-state'])
  })
})
