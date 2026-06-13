import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'

import type { SkillDefinition } from '@bakin/core/plugin-types'

import { getPluginSkills } from '@bakin/core/skills/plugin-skill-registry'
import {
  getAgentPackageSkillOwner,
  getAgentPackageSkills,
} from './agent-package-skill-registry'
import legacyWorkflowSkillHashes from '../defaults/workflow-skill-legacy-hashes.json'

export type WorkflowSkillManagedSourceKind = 'plugin' | 'agent-package'

export type WorkflowSkillDriftRepairability =
  | 'safe-managed'
  | 'known-old-confirmable'
  | 'custom-advisory'
  | 'user-edited'

export interface WorkflowSkillManagedSource {
  kind: WorkflowSkillManagedSourceKind
  id: string
  sourcePath?: string
  skillName: string
}

export interface WorkflowSkillInstallMarker {
  sourceKind: WorkflowSkillManagedSourceKind
  sourceId: string
  sourcePath?: string
  sha256: string
  installedAt: string
}

export interface WorkflowSkillDriftFinding {
  id: string
  label: string
  description: string
  evidence: string[]
}

export interface WorkflowSkillDriftReport {
  skillName: string
  filePath: string
  currentSha256: string
  managedSha256?: string
  managedSource: WorkflowSkillManagedSource
  findings: WorkflowSkillDriftFinding[]
  userEdited: boolean
  installedBy: WorkflowSkillInstallMarker | null
  repairability: WorkflowSkillDriftRepairability
  repairable: boolean
}

export interface RepairWorkflowSkillDriftOptions {
  contentDir: string
  skillName: string
  confirmKnownOld?: boolean
}

export type RepairWorkflowSkillDriftStatus =
  | 'applied'
  | 'not-found'
  | 'not-repairable'
  | 'requires-confirmation'
  | 'source-unavailable'
  | 'failed'

export interface RepairWorkflowSkillDriftResult {
  status: RepairWorkflowSkillDriftStatus
  skillName: string
  message: string
  report?: WorkflowSkillDriftReport
}

interface ManagedSkillSource extends WorkflowSkillManagedSource {
  skill: SkillDefinition
  raw?: string
}

interface DriftPattern {
  id: string
  label: string
  description: string
  stale: RegExp[]
  current?: RegExp[]
}

interface KnownOldWorkflowSkillHash {
  skillName: string
  sourceKind: WorkflowSkillManagedSourceKind
  sourceId: string
  sha256: string
  reason: string
}

const WORKFLOW_SKILL_LEGACY_HASHES = legacyWorkflowSkillHashes as KnownOldWorkflowSkillHash[]

const DRIFT_PATTERNS: DriftPattern[] = [
  {
    id: 'image-output-asset-id',
    label: 'Generated image output contract is stale',
    description: 'This skill still asks agents to return path or filename fields instead of the current assetId.',
    stale: [
      /\bimage_filename\b/g,
      /\bimage_path\b/g,
      /\bimagePath\b/g,
    ],
    current: [/\bassetId\b/g],
  },
  {
    id: 'media-output-asset-id',
    label: 'Generated media output contract is stale',
    description: 'This skill still uses path-style generated media outputs instead of the current managed asset identity.',
    stale: [
      /\bvideo_path\b/g,
      /\bvideoPath\b/g,
      /\baudio_path\b/g,
      /\baudioPath\b/g,
    ],
    current: [/\bassetId\b/g, /\basset_id\b/g],
  },
  {
    id: 'prompt-packet-sidecar',
    label: 'Prompt packet sidecar contract is stale',
    description: 'This skill still references prompt packet sidecar fields that are no longer part of the current image workflow output.',
    stale: [
      /\bpromptAssetFilename\b/g,
      /\bsavePromptPacket\b/g,
    ],
    current: [/\bassetId\b/g],
  },
  {
    id: 'legacy-tool-rename',
    label: 'Legacy execution tool name is stale',
    description: 'This skill still references old execution tool names and may fail when the runtime dispatches the workflow step.',
    stale: [
      /\bbeacon_exec_[A-Za-z0-9_]*\b/g,
      /\bbakin_exec_gen_image\b/g,
    ],
  },
]

export function workflowSkillInstallMarkerPath(skillPath: string): string {
  return `${skillPath}.installedBy`
}

export function workflowSkillUserEditedPath(skillPath: string): string {
  return `${skillPath}.userEdited`
}

export function hashWorkflowSkillContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function readWorkflowSkillInstallMarker(skillPath: string): WorkflowSkillInstallMarker | null {
  const markerPath = workflowSkillInstallMarkerPath(skillPath)
  if (!existsSync(markerPath)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(markerPath, 'utf-8'))
  } catch {
    return null
  }
  if (!isWorkflowSkillInstallMarker(parsed)) return null
  return parsed
}

export function writeWorkflowSkillInstallMarker(skillPath: string, marker: WorkflowSkillInstallMarker): void {
  writeFileSync(
    workflowSkillInstallMarkerPath(skillPath),
    `${JSON.stringify(marker, null, 2)}\n`,
    'utf-8',
  )
}

export function scanWorkflowSkillDrift(contentDir: string): WorkflowSkillDriftReport[] {
  const skillsDir = join(contentDir, 'workflows', 'skills')
  if (!existsSync(skillsDir)) return []

  let files: string[]
  try {
    files = readdirSync(skillsDir).filter((file) => file.endsWith('.md'))
  } catch {
    return []
  }

  const reports: WorkflowSkillDriftReport[] = []
  for (const file of files) {
    const skillName = basename(file, '.md')
    const managed = findManagedSkillSource(skillName)
    if (!managed) continue

    const filePath = join(skillsDir, file)
    let localRaw: string
    try {
      localRaw = readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    const managedRaw = managed.raw ?? managed.skill.instructions
    const findings = findDriftFindings(localRaw, managedRaw)
    if (findings.length === 0) continue

    const currentSha256 = hashWorkflowSkillContent(localRaw)
    const managedSha256 = managed.raw ? hashWorkflowSkillContent(managed.raw) : undefined
    const installedBy = readWorkflowSkillInstallMarker(filePath)
    const userEdited = existsSync(workflowSkillUserEditedPath(filePath))
    const repairability = classifyRepairability({
      skillName,
      currentSha256,
      managed,
      installedBy,
      userEdited,
    })

    reports.push({
      skillName,
      filePath,
      currentSha256,
      managedSha256,
      managedSource: {
        kind: managed.kind,
        id: managed.id,
        sourcePath: managed.sourcePath,
        skillName: managed.skillName,
      },
      findings,
      userEdited,
      installedBy,
      repairability,
      repairable: repairability === 'safe-managed' || repairability === 'known-old-confirmable',
    })
  }

  return reports
}

export function repairWorkflowSkillDrift(options: RepairWorkflowSkillDriftOptions): RepairWorkflowSkillDriftResult {
  const report = scanWorkflowSkillDrift(options.contentDir)
    .find((entry) => entry.skillName === options.skillName)
  if (!report) {
    return {
      status: 'not-found',
      skillName: options.skillName,
      message: `Workflow skill "${options.skillName}" has no detected managed drift.`,
    }
  }

  if (report.repairability === 'known-old-confirmable' && options.confirmKnownOld !== true) {
    return {
      status: 'requires-confirmation',
      skillName: options.skillName,
      message: `Workflow skill "${options.skillName}" matches a known old managed file and requires explicit confirmation before replacement.`,
      report,
    }
  }

  if (report.repairability !== 'safe-managed' && report.repairability !== 'known-old-confirmable') {
    return {
      status: 'not-repairable',
      skillName: options.skillName,
      message: `Workflow skill "${options.skillName}" is not safely repairable because it is ${humanRepairability(report.repairability)}.`,
      report,
    }
  }

  const sourcePath = report.managedSource.sourcePath
  if (!sourcePath || !existsSync(sourcePath)) {
    return {
      status: 'source-unavailable',
      skillName: options.skillName,
      message: `Workflow skill "${options.skillName}" cannot be repaired because the managed source file is unavailable.`,
      report,
    }
  }

  let sourceRaw: string
  try {
    sourceRaw = readFileSync(sourcePath, 'utf-8')
  } catch (err) {
    return {
      status: 'source-unavailable',
      skillName: options.skillName,
      message: `Workflow skill "${options.skillName}" cannot be repaired: ${errorMessage(err)}`,
      report,
    }
  }

  const tmpPath = `${report.filePath}.repair-${process.pid}-${Date.now()}.tmp`
  try {
    writeFileSync(tmpPath, sourceRaw, 'utf-8')
    renameSync(tmpPath, report.filePath)
    writeWorkflowSkillInstallMarker(report.filePath, {
      sourceKind: report.managedSource.kind,
      sourceId: report.managedSource.id,
      sourcePath,
      sha256: hashWorkflowSkillContent(sourceRaw),
      installedAt: new Date().toISOString(),
    })
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {
      // best-effort cleanup only
    }
    return {
      status: 'failed',
      skillName: options.skillName,
      message: `Workflow skill "${options.skillName}" repair failed: ${errorMessage(err)}`,
      report,
    }
  }

  return {
    status: 'applied',
    skillName: options.skillName,
    message: `Workflow skill "${options.skillName}" was replaced from the current managed source.`,
    report,
  }
}

function findManagedSkillSource(skillName: string): ManagedSkillSource | null {
  const packageSkill = getAgentPackageSkills().get(skillName)
  if (packageSkill) {
    const sourcePath = packageSkill.sourcePath
    return {
      kind: 'agent-package',
      id: getAgentPackageSkillOwner(skillName) ?? 'unknown',
      skillName,
      skill: packageSkill,
      sourcePath,
      raw: readOptionalFile(sourcePath),
    }
  }

  const pluginSkill = getPluginSkills().get(skillName)
  if (pluginSkill) {
    const sourcePath = pluginSkill.sourcePath
    return {
      kind: 'plugin',
      id: pluginIdForSkill(pluginSkill),
      skillName,
      skill: pluginSkill,
      sourcePath,
      raw: readOptionalFile(sourcePath),
    }
  }

  return null
}

function findDriftFindings(localRaw: string, managedRaw: string): WorkflowSkillDriftFinding[] {
  const findings: WorkflowSkillDriftFinding[] = []
  for (const pattern of DRIFT_PATTERNS) {
    if (pattern.current && !pattern.current.some((matcher) => regexMatches(managedRaw, matcher))) continue
    const localEvidence = Array.from(new Set(pattern.stale.flatMap((matcher) => collectMatches(localRaw, matcher))))
    if (localEvidence.length === 0) continue
    const managedEvidence = new Set(pattern.stale.flatMap((matcher) => collectMatches(managedRaw, matcher)))
    const evidence = localEvidence.filter((token) => !managedEvidence.has(token))
    if (evidence.length === 0) continue
    findings.push({
      id: pattern.id,
      label: pattern.label,
      description: pattern.description,
      evidence,
    })
  }
  return findings
}

function regexMatches(text: string, matcher: RegExp): boolean {
  const flags = matcher.flags.replace('g', '')
  return new RegExp(matcher.source, flags).test(text)
}

function classifyRepairability(input: {
  skillName: string
  currentSha256: string
  managed: ManagedSkillSource
  installedBy: WorkflowSkillInstallMarker | null
  userEdited: boolean
}): WorkflowSkillDriftRepairability {
  if (input.userEdited) return 'user-edited'
  if (markerMatchesManagedSource(input.installedBy, input.managed) && input.installedBy?.sha256 === input.currentSha256) {
    return 'safe-managed'
  }
  if (isKnownOldWorkflowSkillHash(input.skillName, input.currentSha256, input.managed)) {
    return 'known-old-confirmable'
  }
  return 'custom-advisory'
}

function markerMatchesManagedSource(marker: WorkflowSkillInstallMarker | null, managed: ManagedSkillSource): boolean {
  if (!marker) return false
  return marker.sourceKind === managed.kind && marker.sourceId === managed.id
}

function isKnownOldWorkflowSkillHash(skillName: string, sha256: string, managed: ManagedSkillSource): boolean {
  return WORKFLOW_SKILL_LEGACY_HASHES.some((entry) =>
    entry.skillName === skillName &&
    entry.sha256 === sha256 &&
    entry.sourceKind === managed.kind &&
    entry.sourceId === managed.id
  )
}

function humanRepairability(repairability: WorkflowSkillDriftRepairability): string {
  switch (repairability) {
    case 'custom-advisory':
      return 'an unmarked or customized local shadow file'
    case 'user-edited':
      return 'marked as user-edited'
    case 'known-old-confirmable':
      return 'a known old managed file that requires confirmation'
    case 'safe-managed':
      return 'managed and unedited'
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isWorkflowSkillInstallMarker(value: unknown): value is WorkflowSkillInstallMarker {
  if (!value || typeof value !== 'object') return false
  const marker = value as Record<string, unknown>
  return (
    (marker.sourceKind === 'plugin' || marker.sourceKind === 'agent-package') &&
    typeof marker.sourceId === 'string' &&
    typeof marker.sha256 === 'string' &&
    typeof marker.installedAt === 'string' &&
    (marker.sourcePath === undefined || typeof marker.sourcePath === 'string')
  )
}

function pluginIdForSkill(skill: SkillDefinition): string {
  if (skill.source?.startsWith('plugin:')) {
    return skill.source.slice('plugin:'.length)
  }
  return 'unknown'
}

function readOptionalFile(path: string | undefined): string | undefined {
  if (!path || !existsSync(path)) return undefined
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return undefined
  }
}

function collectMatches(text: string, matcher: RegExp): string[] {
  const flags = matcher.flags.includes('g') ? matcher.flags : `${matcher.flags}g`
  const regex = new RegExp(matcher.source, flags)
  const matches: string[] = []
  for (const match of text.matchAll(regex)) {
    if (match[0]) matches.push(match[0])
  }
  return matches
}
