/**
 * Re-homing table rows 127–144 (self-healing 1.7): the workflows-owned
 * families, their effects/mode, and each row's emitted shape — a human
 * decision on the record's recover view (required only while in use), a
 * repair, a core.diagnose investigation, or an observation with no card.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-workflows-rehoming-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = `${testDir}-openclaw`

const pluginSkills = new Map<string, unknown>()
mock.module('@bakin/core/main-agent', () => ({ getMainAgentId: () => 'main', tryGetMainAgentId: () => 'main', getMainAgentName: () => 'Main' }))
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => `${testDir}/.openclaw`,
  getOpenClawPath: (p = '') => `${testDir}/.openclaw/${p}`,
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))
const board = { columns: { todo: [{ id: 'task-exists' }], inProgress: [], review: [], done: [], archived: [], blocked: [], backlog: [] } }
mock.module('../../../src/core/task-store', () => ({ readTaskboard: () => board }))
mock.module('@/core/task-store', () => ({ readTaskboard: () => board }))
const registry = () => ({ invoke: async () => undefined, has: () => false, register: () => () => {} })
mock.module('../../../src/core/plugin-registry', () => ({ getPluginSkills: () => pluginSkills, getHookRegistry: registry }))
mock.module('@bakin/core/skills/plugin-skill-registry', () => ({ getPluginSkills: () => pluginSkills }))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({ getHookRegistry: registry }))

import { repairMode } from '@bakin/core/health/repair-mode'
import {
  WORKFLOW_DEFINITIONS_INCIDENTS,
  WORKFLOW_INSTANCES_INCIDENTS,
  WORKFLOW_SKILLS_INCIDENTS,
  checkStaleWorkflowInstances,
  checkWorkflowDefinitions,
  checkWorkflowSkills,
  staleWorkflowInstancesRepair,
  workflowSkillDriftRepair,
} from '../../../plugins/workflows/lib/health-checks'
import { SHIPPED_DEFAULTS_INCIDENTS, checkShippedDefaults, recordShippedDefaults, resetShippedDefaults } from '../../../plugins/workflows/lib/shipped-defaults'
import { hashWorkflowSkillContent, writeWorkflowSkillInstallMarker } from '../../../plugins/workflows/lib/workflow-skill-drift'

const skillsDir = join(testDir, 'workflows', 'skills')
const definitionsDir = join(testDir, 'workflows', 'definitions')
const instancesDir = join(testDir, 'workflows', 'instances')

type Row = { key: string; status: string; incident?: Record<string, unknown> & { resolution: Record<string, unknown> } }
function rows(result: { outcome: string }): Row[] {
  if (result.outcome !== 'observed') throw new Error(`expected observed, got ${result.outcome}`)
  return (result as unknown as { observations: Row[] }).observations
}
const decision = (href: string) => ({ type: 'human', needs: 'decision', href })

const workflowYaml = (name: string, steps: string) => `name: ${name}\ndescription: d\nversion: 1\nsteps:\n${steps}`
const skillStep = (id: string, skill: string) => `  - id: ${id}\n    label: ${id}\n    type: agent\n    agent: main\n    skill: ${skill}\n`

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  for (const dir of [skillsDir, definitionsDir, instancesDir]) mkdirSync(dir, { recursive: true })
  pluginSkills.clear()
  resetShippedDefaults()
})
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('workflows re-homing catalogs (rows 127–144)', () => {
  it('declares exactly the families the table names; observation rows have none', () => {
    expect(WORKFLOW_SKILLS_INCIDENTS).toEqual([
      { id: 'frontmatter', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' }, // 127
      { id: 'output-schema', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' }, // 128
      { id: 'drift', subjectKind: 'record', resolution: { type: 'repair', actionId: 'repair-skill-drift' }, required: 'always' }, // 131
    ]) // 129, 130, 132 are observations
    expect(WORKFLOW_DEFINITIONS_INCIDENTS).toEqual([
      { id: 'schema', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' }, // 133
      { id: 'skill', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' }, // 134
      { id: 'nested', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' }, // 135
      { id: 'parallel-skill', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' }, // 137
    ]) // 136, 138 are observations
    expect(WORKFLOW_INSTANCES_INCIDENTS).toEqual([
      { id: 'orphan', subjectKind: 'task', resolution: { type: 'repair', actionId: 'remove-orphan-instances' }, required: 'never' }, // 140
    ]) // 139, 141 are observations
    expect(SHIPPED_DEFAULTS_INCIDENTS).toEqual([
      { id: 'shipped-defaults-missing', subjectKind: 'system', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' }, // 143
    ]) // 142, 144 are observations
  })

  it('actions carry the table effects: drift repair self-heals by default; orphan removal deletes → one-click', () => {
    const drift = workflowSkillDriftRepair(testDir)
    expect(drift.effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false })
    expect(repairMode(drift.effects)).toBe('self-heal')
    const orphans = staleWorkflowInstancesRepair(testDir)
    expect(orphans.effects).toEqual({ deletesUserContent: true, spendsMoney: false, widensAuthorization: false })
    expect(repairMode(orphans.effects)).toBe('one-click')
    expect(orphans.mutation).toBe('delete')
  })
})

describe('workflows re-homing emissions — skills (127–132)', () => {
  it('127/128 frontmatter and output-schema → human decision on the skill editor; required only while a definition references the skill', () => {
    writeFileSync(join(skillsDir, 'loose.md'), 'no frontmatter here')
    writeFileSync(join(skillsDir, 'used.md'), '---\nname: Used\n---\nbody without a schema\n')
    writeFileSync(join(definitionsDir, 'uses.yaml'), workflowYaml('Uses', skillStep('s1', 'used')))
    const all = rows(checkWorkflowSkills(testDir))
    const loose = all.find((r) => r.key === 'frontmatter-loose.md')
    const used = all.find((r) => r.key === 'output-schema-used.md')
    expect(loose!.incident).toMatchObject({ declarationId: 'frontmatter', required: false, disposition: 'advisory', subject: { kind: 'record', id: 'workflows/skills/loose.md' }, resolution: decision('/workflows?recover=1&skill=loose.md') })
    expect(used!.incident).toMatchObject({ declarationId: 'output-schema', required: true, disposition: 'action_required', subject: { kind: 'record', id: 'workflows/skills/used.md' }, resolution: decision('/workflows?recover=1&skill=used.md') })
  })

  it('129 an unreadable skill file and 130 an uninspectable skills directory are observations', () => {
    mkdirSync(join(skillsDir, 'dir.md')) // EISDIR on read
    const [unreadable] = rows(checkWorkflowSkills(testDir))
    expect(unreadable).toMatchObject({ key: 'unreadable-dir.md', status: 'warning' })
    expect(unreadable!.incident).toBeUndefined()

    rmSync(skillsDir, { recursive: true, force: true })
    writeFileSync(skillsDir, 'not a directory') // ENOTDIR on readdir
    const [dir] = rows(checkWorkflowSkills(testDir))
    expect(dir).toMatchObject({ key: 'skills-directory', status: 'unknown' })
    expect(dir!.incident).toBeUndefined()
  })

  it('131 repairable drift → repair-skill-drift (user-edited items stamp deletesUserContent); 132 unmarked drift is an observation', async () => {
    // The same stale-vs-managed pair the skills health test uses (the scanner's drift findings are specific).
    const sourcePath = join(testDir, 'managed-generate-image.md')
    const current = '---\nname: Generate Image\noutput_schema:\n  type: object\n  required: [assetId]\n---\n\nReturn assetId.\n'
    const stale = '---\nname: Generate Image\noutput_schema:\n  type: object\n  required: [image_filename]\n---\n\nReturn image_filename and promptAssetFilename after savePromptPacket.\n'
    writeFileSync(sourcePath, current)
    pluginSkills.set('generate-image', { name: 'Generate Image', instructions: 'Return assetId.', source: 'plugin:images', sourcePath })
    const target = join(skillsDir, 'generate-image.md')
    writeFileSync(target, stale)
    // Unmarked local file: not repairable → observation (132).
    const [unmarked] = rows(checkWorkflowSkills(testDir))
    expect(unmarked).toMatchObject({ key: 'drift-generate-image', status: 'warning' })
    expect(unmarked!.incident).toBeUndefined()

    // Marked managed file whose bytes still match the install: repairable (131).
    writeWorkflowSkillInstallMarker(target, { sourceKind: 'plugin', sourceId: 'images', sourcePath, sha256: hashWorkflowSkillContent(stale), installedAt: '2026-06-02T00:00:00.000Z' })
    const [marked] = rows(checkWorkflowSkills(testDir))
    expect(marked!.incident).toMatchObject({ declarationId: 'drift', disposition: 'action_required', subject: { kind: 'record', id: 'workflows/skills/generate-image.md' }, resolution: { type: 'repair', actionId: 'repair-skill-drift' } })
    const plan = await workflowSkillDriftRepair(testDir).plan({ type: 'all_actionable', reportId: 'r' })
    expect(plan).toHaveLength(1)
    expect(plan[0]!.effects).toBeUndefined() // untouched managed file → the action's self-heal effects
  })
})

describe('workflows re-homing emissions — definitions (133–138)', () => {
  it('133/134/135/137 → human decision on the recover editor, required while the workflow runs; 136 nested-map is an observation', async () => {
    writeFileSync(join(definitionsDir, 'broken.yaml'), workflowYaml('broken',
      '  - id: s1\n    label: S1\n    type: agent\n    agent: main\n    bogus: 1\n'
      + skillStep('s2', 'missing-skill')
      + '  - id: s3\n    label: S3\n    type: workflow\n    workflow_id: nowhere\n'
      + '  - id: s4\n    label: S4\n    type: parallel\n    steps:\n      - id: s4a\n        label: S4a\n        type: agent\n        agent: main\n        skill: also-missing\n'
      + '  - id: s5\n    label: S5\n    type: map_workflow\n    workflow_id: child\n    items: "{{x}}"\n'))
    writeFileSync(join(definitionsDir, 'child.yaml'), workflowYaml('child', '  - id: c1\n    label: C1\n    type: map_workflow\n    workflow_id: broken\n    items: "{{y}}"\n'))
    // `broken` is running: its rows are required; `child` is idle: advisory.
    writeFileSync(join(instancesDir, 'task-exists.json'), JSON.stringify({ instanceId: 'i1', taskId: 'task-exists', workflowId: 'broken', status: 'in_progress', currentStepId: 's1', updatedAt: new Date().toISOString() }))
    const all = rows(await checkWorkflowDefinitions(testDir))
    const byPrefix = (prefix: string) => all.find((r) => r.key.startsWith(prefix))
    const subject = { kind: 'record', id: 'workflows/broken' }
    expect(byPrefix('schema-broken-')?.incident).toMatchObject({ declarationId: 'schema', required: true, disposition: 'action_required', subject, resolution: decision('/workflows/broken?recover=1') })
    expect(byPrefix('skill-broken-s2-')?.incident).toMatchObject({ declarationId: 'skill', required: true, subject, resolution: decision('/workflows/broken?recover=1&step=s2') })
    expect(byPrefix('nested-broken-s3-')?.incident).toMatchObject({ declarationId: 'nested', required: true, subject, resolution: decision('/workflows/broken?recover=1&step=s3') })
    expect(byPrefix('parallel-skill-broken-s4a-')?.incident).toMatchObject({ declarationId: 'parallel-skill', required: true, subject, resolution: decision('/workflows/broken?recover=1&step=s4') })
    const nestedMap = byPrefix('nested-map-broken-s5')
    expect(nestedMap).toMatchObject({ status: 'warning' })
    expect(nestedMap?.incident).toBeUndefined()
    // The idle child's own nested-map row (child → broken) is an observation too; nothing else about it is required.
    expect(all.filter((r) => r.key.startsWith('nested-map-child-')).every((r) => r.incident === undefined)).toBe(true)
  })

  // 138 definitions-scan: `listDefinitions` tolerates a missing dir and the
  // mocks cannot make it throw — catalog-only (no family, by design).
})

describe('workflows re-homing emissions — instances and shipped defaults (139–144)', () => {
  it('140 orphan → one-click remove-orphan-instances, advisory and not required; 141 stale is an observation', async () => {
    const now = new Date().toISOString()
    writeFileSync(join(instancesDir, 'gone.json'), JSON.stringify({ instanceId: 'i1', taskId: 'gone', workflowId: 'w', status: 'in_progress', currentStepId: 's1', updatedAt: now }))
    writeFileSync(join(instancesDir, 'task-exists.json'), JSON.stringify({ instanceId: 'i2', taskId: 'task-exists', workflowId: 'w', status: 'in_progress', currentStepId: 'wait', updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }))
    const all = rows(await checkStaleWorkflowInstances(testDir))
    const orphan = all.find((r) => r.key === 'orphan-gone')
    const stale = all.find((r) => r.key === 'stale-task-exists')
    expect(orphan!.incident).toMatchObject({ declarationId: 'orphan', disposition: 'advisory', subject: { kind: 'task', id: 'gone' }, resolution: { type: 'repair', actionId: 'remove-orphan-instances' } })
    expect(stale).toMatchObject({ status: 'warning' })
    expect(stale!.incident).toBeUndefined()
  })

  // 139 instances-scan: the scan tolerates a missing dir; catalog-only.

  it('142 pending and 144 a skipped shipped workflow are observations; 143 missing defaults → core.diagnose folded under the Bakin subject', () => {
    const [pending] = rows(checkShippedDefaults())
    expect(pending).toMatchObject({ key: 'shipped-defaults', status: 'unknown' })
    expect(pending!.incident).toBeUndefined()

    recordShippedDefaults({ files: [], registered: [], skipped: [], pluginPath: '/$bunfs/root' })
    const [missing] = rows(checkShippedDefaults())
    expect(missing!.incident).toMatchObject({
      declarationId: 'shipped-defaults-missing', disposition: 'action_required',
      subject: { kind: 'system', id: 'workflow-defaults' },
      dependsOn: { subject: { kind: 'system', id: 'bakin' }, resolvedBy: 'core.self-update' },
      resolution: { type: 'repair', actionId: 'core.diagnose' },
    })

    recordShippedDefaults({ files: [{ id: 'bad', path: '/x/bad.yaml', source: 'disk' }], registered: [], skipped: [{ id: 'bad', errors: ['steps: required'] }], pluginPath: process.cwd() })
    const [skipped] = rows(checkShippedDefaults())
    expect(skipped).toMatchObject({ key: 'shipped-default-bad', status: 'warning' })
    expect(skipped!.incident).toBeUndefined()
  })
})
