import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-workflow-skill-drift-${Date.now()}-${randomUUID()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ workflows: join(testDir, 'workflows') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/task-store', () => ({}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  readWorkflowSkillInstallMarker,
  hashWorkflowSkillContent,
  repairWorkflowSkillDrift,
  scanWorkflowSkillDrift,
  workflowSkillInstallMarkerPath,
  workflowSkillUserEditedPath,
  writeWorkflowSkillInstallMarker,
} from '../../../plugins/workflows/lib/workflow-skill-drift'
import {
  clearAgentPackageSkillRegistry,
  registerAgentPackageSkill,
} from '../../../plugins/workflows/lib/agent-package-skill-registry'
import { getPluginSkills } from '../../../src/core/plugin-registry'

const skillsDir = join(testDir, 'workflows', 'skills')
const managedDir = join(testDir, 'managed')

const currentGenerateImageSkill = `---
name: Generate Image
output_schema:
  type: object
  required:
    - assetId
  properties:
    assetId:
      type: string
---

Return the generated assetId from bakin_exec_images_generate.
`

const documentedStaleTokenGenerateImageSkill = `---
name: Generate Image
output_schema:
  type: object
  required:
    - assetId
  properties:
    assetId:
      type: string
---

Return the generated assetId. Do not return image_filename.
`

const staleGenerateImageSkill = `---
name: Generate Image
output_schema:
  type: object
  required:
    - image_filename
  properties:
    image_filename:
      type: string
    promptAssetFilename:
      type: string
---

Return image_filename, filename, and promptAssetFilename after savePromptPacket completes.
`

const knownOldGenerateImageSkill = `---
output_schema:
  type: object
  required:
    - image_filename
    - filename
    - provider
    - model
    - surface
  properties:
    image_filename:
      type: string
      description: "Canonical generated image asset filename. Do not emit a directory path."
    filename:
      type: string
      description: "Same canonical generated image asset filename."
    provider:
      type: string
    model:
      type: string
    surface:
      type: string
    width:
      type: number
    height:
      type: number
    promptHash:
      type: string
    promptAssetFilename:
      type: string
---

## Instructions

Generate the approved image through the images plugin. The plugin owns
runtime/native routing, provider authentication, asset saving, and sidecar
metadata.

1. Read the approved prompt, promptPacket, route, surface, and quality from priorStepOutput.
2. Call \`bakin_exec_images_generate\` with the current task id, \`promptPacket\`, \`prompt\`, \`provider\`, \`model\`, \`surface\`, \`quality\`, and \`savePromptPacket: true\` when the workflow has an approval gate.
3. Verify the tool returned \`ok: true\`.
4. Submit the tool's returned \`image_filename\`, \`filename\`, provider, model, surface, width, height, promptHash, and promptAssetFilename.

Do not call legacy image tools. Do not write image files, thumbnails, or sidecars by hand. Do not emit a local filesystem path as the image identity.
`

function seedPluginManagedSkill(): string {
  mkdirSync(managedDir, { recursive: true })
  const sourcePath = join(managedDir, 'generate-image.md')
  writeFileSync(sourcePath, currentGenerateImageSkill, 'utf-8')
  getPluginSkills().set('generate-image', {
    name: 'Generate Image',
    instructions: 'Return the generated assetId from bakin_exec_images_generate.',
    output_schema: {
      type: 'object',
      required: ['assetId'],
      properties: { assetId: { type: 'string' } },
    },
    source: 'plugin:images',
    sourcePath,
  })
  return sourcePath
}

describe('workflow skill drift scanner', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(skillsDir, { recursive: true })
    getPluginSkills().clear()
    clearAgentPackageSkillRegistry()
  })

  afterEach(() => {
    getPluginSkills().clear()
    clearAgentPackageSkillRegistry()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('flags a local workflow skill that shadows a managed plugin skill with stale image-output fields', () => {
    seedPluginManagedSkill()
    writeFileSync(join(skillsDir, 'generate-image.md'), staleGenerateImageSkill, 'utf-8')

    const reports = scanWorkflowSkillDrift(testDir)

    expect(reports).toHaveLength(1)
    expect(reports[0].skillName).toBe('generate-image')
    expect(reports[0].managedSource).toEqual(expect.objectContaining({
      kind: 'plugin',
      id: 'images',
    }))
    expect(reports[0].findings.map((finding) => finding.id)).toContain('image-output-asset-id')
    expect(reports[0].findings.map((finding) => finding.id)).toContain('prompt-packet-sidecar')
    expect(reports[0].repairability).toBe('custom-advisory')
    expect(reports[0].repairable).toBe(false)
  })

  it('does not flag user-only workflow skills that do not shadow a managed source', () => {
    writeFileSync(join(skillsDir, 'generate-image.md'), staleGenerateImageSkill, 'utf-8')

    expect(scanWorkflowSkillDrift(testDir)).toEqual([])
  })

  it('does not flag exact managed content that documents a stale token', () => {
    const sourcePath = seedPluginManagedSkill()
    writeFileSync(sourcePath, documentedStaleTokenGenerateImageSkill, 'utf-8')
    const target = join(skillsDir, 'generate-image.md')
    writeFileSync(target, documentedStaleTokenGenerateImageSkill, 'utf-8')

    const reports = scanWorkflowSkillDrift(testDir)

    expect(reports).toEqual([])
  })

  it('marks user-edited stale shadow files as advisory-only', () => {
    seedPluginManagedSkill()
    const target = join(skillsDir, 'generate-image.md')
    writeFileSync(target, staleGenerateImageSkill, 'utf-8')
    writeFileSync(workflowSkillUserEditedPath(target), '', 'utf-8')

    const [report] = scanWorkflowSkillDrift(testDir)

    expect(report.userEdited).toBe(true)
    expect(report.repairability).toBe('user-edited')
    expect(report.repairable).toBe(false)
  })

  it('marks stale files repairable when .installedBy proves the file is still managed and unedited', () => {
    const sourcePath = seedPluginManagedSkill()
    const target = join(skillsDir, 'generate-image.md')
    writeFileSync(target, staleGenerateImageSkill, 'utf-8')
    writeWorkflowSkillInstallMarker(target, {
      sourceKind: 'plugin',
      sourceId: 'images',
      sourcePath,
      sha256: hashWorkflowSkillContent(staleGenerateImageSkill),
      installedAt: '2026-06-02T00:00:00.000Z',
    })

    const [report] = scanWorkflowSkillDrift(testDir)

    expect(report.repairability).toBe('safe-managed')
    expect(report.repairable).toBe(true)
    expect(readWorkflowSkillInstallMarker(target)?.sourceId).toBe('images')
    expect(workflowSkillInstallMarkerPath(target)).toBe(`${target}.installedBy`)
  })

  it('uses the agent-package source when a package skill shadows a plugin skill', () => {
    seedPluginManagedSkill()
    const packageSourcePath = join(managedDir, 'pkg-generate-image.md')
    writeFileSync(packageSourcePath, currentGenerateImageSkill, 'utf-8')
    registerAgentPackageSkill('pixel', 'generate-image', {
      name: 'Generate Image',
      instructions: 'Return the generated assetId from package source.',
      sourcePath: packageSourcePath,
    })
    writeFileSync(join(skillsDir, 'generate-image.md'), staleGenerateImageSkill, 'utf-8')

    const [report] = scanWorkflowSkillDrift(testDir)

    expect(report.managedSource.kind).toBe('agent-package')
    expect(report.managedSource.id).toBe('pixel')
    expect(report.managedSource.sourcePath).toBe(packageSourcePath)
  })

  it('repairs a stale managed skill by replacing it from the current source', () => {
    const sourcePath = seedPluginManagedSkill()
    const target = join(skillsDir, 'generate-image.md')
    writeFileSync(target, staleGenerateImageSkill, 'utf-8')
    writeWorkflowSkillInstallMarker(target, {
      sourceKind: 'plugin',
      sourceId: 'images',
      sourcePath,
      sha256: hashWorkflowSkillContent(staleGenerateImageSkill),
      installedAt: '2026-06-02T00:00:00.000Z',
    })

    const result = repairWorkflowSkillDrift({
      contentDir: testDir,
      skillName: 'generate-image',
    })

    expect(result.status).toBe('applied')
    expect(readFileSync(target, 'utf-8')).toBe(currentGenerateImageSkill)
    expect(readWorkflowSkillInstallMarker(target)).toEqual(expect.objectContaining({
      sourceKind: 'plugin',
      sourceId: 'images',
      sourcePath,
      sha256: hashWorkflowSkillContent(currentGenerateImageSkill),
    }))
  })

  it('requires confirmation before replacing a known old managed skill without an install marker', () => {
    seedPluginManagedSkill()
    const target = join(skillsDir, 'generate-image.md')
    writeFileSync(target, knownOldGenerateImageSkill, 'utf-8')

    const [report] = scanWorkflowSkillDrift(testDir)

    expect(report.repairability).toBe('known-old-confirmable')
    expect(report.repairable).toBe(true)

    const blocked = repairWorkflowSkillDrift({
      contentDir: testDir,
      skillName: 'generate-image',
    })

    expect(blocked.status).toBe('requires-confirmation')
    expect(readFileSync(target, 'utf-8')).toBe(knownOldGenerateImageSkill)

    const applied = repairWorkflowSkillDrift({
      contentDir: testDir,
      skillName: 'generate-image',
      confirmKnownOld: true,
    })

    expect(applied.status).toBe('applied')
    expect(readFileSync(target, 'utf-8')).toBe(currentGenerateImageSkill)
  })

  it('does not repair stale custom shadows without managed provenance', () => {
    seedPluginManagedSkill()
    const target = join(skillsDir, 'generate-image.md')
    writeFileSync(target, staleGenerateImageSkill, 'utf-8')

    const result = repairWorkflowSkillDrift({
      contentDir: testDir,
      skillName: 'generate-image',
    })

    expect(result.status).toBe('not-repairable')
    expect(readFileSync(target, 'utf-8')).toBe(staleGenerateImageSkill)
  })

  it('does not repair stale user-edited shadows', () => {
    const sourcePath = seedPluginManagedSkill()
    const target = join(skillsDir, 'generate-image.md')
    writeFileSync(target, staleGenerateImageSkill, 'utf-8')
    writeFileSync(workflowSkillUserEditedPath(target), '', 'utf-8')
    writeWorkflowSkillInstallMarker(target, {
      sourceKind: 'plugin',
      sourceId: 'images',
      sourcePath,
      sha256: hashWorkflowSkillContent(staleGenerateImageSkill),
      installedAt: '2026-06-02T00:00:00.000Z',
    })

    const result = repairWorkflowSkillDrift({
      contentDir: testDir,
      skillName: 'generate-image',
    })

    expect(result.status).toBe('not-repairable')
    expect(readFileSync(target, 'utf-8')).toBe(staleGenerateImageSkill)
  })
})
