/**
 * The shared component-install request (#895 D11): explicit options with safe
 * defaults, every installable component, and nothing the schema doesn't name.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-install-request-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))
import { COMPONENT_ORDER, isInstallable } from '../../../src/core/onboarding/index'
import { INSTALLABLE_COMPONENTS, OnboardingInstallRequestSchema } from '../../../src/core/onboarding/install-request'

describe('OnboardingInstallRequestSchema', () => {
  it('defaults to no approval and no service claim', () => {
    expect(OnboardingInstallRequestSchema.parse({ component: 'media' })).toEqual({
      component: 'media',
      options: { autoApprove: false, allowServiceClaim: false },
    })
  })

  it('carries the wizard selections through', () => {
    const parsed = OnboardingInstallRequestSchema.parse({
      component: 'recommended-plugins',
      options: { autoApprove: true, selectedRecommendedPluginIds: ['bits'], approvedComponents: ['recommended-plugins'] },
    })
    expect(parsed.options).toMatchObject({ autoApprove: true, selectedRecommendedPluginIds: ['bits'] })
  })

  it('rejects an unknown component, a check-only component and an unknown option', () => {
    expect(OnboardingInstallRequestSchema.safeParse({ component: 'nope' }).success).toBe(false)
    expect(OnboardingInstallRequestSchema.safeParse({ component: 'runtime' }).success).toBe(false)
    expect(OnboardingInstallRequestSchema.safeParse({ component: 'media', options: { interactive: true } }).success).toBe(false)
  })

  it('names exactly the components that have an install', () => {
    expect(COMPONENT_ORDER.filter(isInstallable).map((c) => c.name).sort()).toEqual([...INSTALLABLE_COMPONENTS].sort())
    expect(COMPONENT_ORDER.filter((c) => !isInstallable(c)).map((c) => c.name).sort()).toEqual(['budget', 'channels', 'llm', 'runtime'])
  })
})

describe('component plans', () => {
  it('every component declares a plan whose point of no return names one of its stages, and canonical resources', () => {
    const resources = ['install-state', 'media-store', 'search-engine']
    for (const component of COMPONENT_ORDER.filter(isInstallable)) {
      const plan = component.plan
      expect(plan.stages.length).toBeGreaterThan(0)
      const ids = plan.stages.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
      if (plan.pointOfNoReturn !== null && plan.pointOfNoReturn !== 'start') expect(ids).toContain(plan.pointOfNoReturn)
      for (const r of component.resources) expect(resources).toContain(r)
    }
  })
})
