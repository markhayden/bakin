import { existsSync, readFileSync, statSync } from 'fs'
import { splitFrontmatter } from '@bakin/core/format/frontmatter'
import { basename, isAbsolute, normalize, relative, resolve } from 'path'
import yaml from 'js-yaml'
import type { Manifest } from '../../../packages/core/src/agent-packages/manifest'
import type { WorkflowDefinition } from '@bakin/core/workflows/definition-types'
import { validateDefinition } from '@bakin/core/workflows/validate-definition'
import { validatePackageLessonIntegrity } from './lesson-integrity'

export interface PackageIntegrityOptions {
  manifest: Manifest
  stagingDir: string
  enabledLessons?: string[]
}

export function validatePackageContributionIntegrity(options: PackageIntegrityOptions): void {
  validatePackageLessonIntegrity(options)

  const { manifest, stagingDir } = options
  switch (manifest.kind) {
    case 'agent':
      validateFiles(stagingDir, manifest.contributions.workspaceFiles ?? [], 'workspace file', 'source')
      validateSkillDirectories(stagingDir, manifest.contributions.skills ?? [])
      validateWorkflowFiles(stagingDir, manifest.id, manifest.contributions.workflows ?? [])
      validateWorkflowSkillFiles(stagingDir, manifest.contributions.workflowSkills ?? [])
      validateFiles(stagingDir, manifest.contributions.assets ?? [], 'asset')
      validateFiles(stagingDir, manifest.contributions.persona ? [manifest.contributions.persona] : [], 'persona')
      break
    case 'skill-pack':
      validateSkillDirectories(stagingDir, manifest.contributions.skills)
      validateFiles(stagingDir, manifest.contributions.assets ?? [], 'asset')
      break
    case 'workflow-pack':
      validateWorkflowFiles(stagingDir, manifest.id, manifest.contributions.workflows ?? [])
      validateWorkflowSkillFiles(stagingDir, manifest.contributions.workflowSkills ?? [])
      validateFiles(stagingDir, manifest.contributions.assets ?? [], 'asset')
      break
    case 'lesson-pack':
      validateFiles(stagingDir, manifest.contributions.assets ?? [], 'asset')
      break
  }
}

function validateFiles(stagingDir: string, rels: string[], label: string, sourceLabel = 'source file'): void {
  for (const rel of rels) {
    const abs = resolvePackagePath(stagingDir, rel)
    if (!existsSync(abs)) {
      throw new Error(`${label} ${sourceLabel} is missing: ${rel}`)
    }
    if (!statSync(abs).isFile()) {
      throw new Error(`${label} source path is not a file: ${rel}`)
    }
  }
}

function validateSkillDirectories(stagingDir: string, rels: string[]): void {
  for (const rel of rels) {
    const abs = resolvePackagePath(stagingDir, rel)
    if (!existsSync(abs)) {
      throw new Error(`Skill source directory is missing: ${rel}`)
    }
    if (!statSync(abs).isDirectory()) {
      throw new Error(`Skill source path is not a directory: ${rel}`)
    }

    const skillPath = resolve(abs, 'SKILL.md')
    if (!existsSync(skillPath)) {
      throw new Error(`SKILL.md is missing for skill source directory: ${rel}`)
    }
    if (!statSync(skillPath).isFile()) {
      throw new Error(`SKILL.md is not a file for skill source directory: ${rel}`)
    }
    if (!readFileSync(skillPath, 'utf-8').trim()) {
      throw new Error(`SKILL.md is empty for skill source directory: ${rel}`)
    }
  }
}

function validateWorkflowFiles(stagingDir: string, packageId: string, rels: string[]): void {
  const parsed: Array<{ id: string; rel: string; definition: WorkflowDefinition }> = []
  for (const rel of rels) {
    if (!/\.(yaml|yml)$/i.test(rel)) {
      throw new Error(`Workflow source file must be YAML: ${rel}`)
    }
    const abs = resolvePackagePath(stagingDir, rel)
    if (!existsSync(abs)) {
      throw new Error(`Workflow source file is missing: ${rel}`)
    }
    if (!statSync(abs).isFile()) {
      throw new Error(`Workflow source path is not a file: ${rel}`)
    }

    let definition: WorkflowDefinition
    try {
      definition = yaml.load(readFileSync(abs, 'utf-8')) as WorkflowDefinition
    } catch (err) {
      throw new Error(
        `Workflow source file is invalid: ${rel}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (!definition || typeof definition !== 'object') {
      throw new Error(`Workflow source file is invalid: ${rel}: expected a workflow object`)
    }
    parsed.push({
      id: deriveWorkflowId(definition, basename(rel).replace(/\.(yaml|yml)$/i, '')),
      rel,
      definition,
    })
  }

  const knownWorkflowIds = new Set(parsed.map((entry) => entry.id))
  for (const { id, rel, definition } of parsed) {
    const errors = validateDefinition(definition, {
      definitionId: id,
      source: 'agent-package',
      knownWorkflowIds,
    })
    if (errors.length > 0) {
      throw new Error(`Workflow source file is invalid: ${rel}: ${errors.join('; ')}`)
    }
  }

  const seen = new Map<string, string>()
  for (const { id, rel } of parsed) {
    const existing = seen.get(id)
    if (existing) {
      throw new Error(`Duplicate workflow id "${id}" in package "${packageId}": ${existing} and ${rel}`)
    }
    seen.set(id, rel)
  }
}

function validateWorkflowSkillFiles(stagingDir: string, rels: string[]): void {
  for (const rel of rels) {
    if (!/\.md$/i.test(rel)) {
      throw new Error(`Workflow-skill source file must be Markdown: ${rel}`)
    }
    const abs = resolvePackagePath(stagingDir, rel)
    if (!existsSync(abs)) {
      throw new Error(`Workflow-skill source file is missing: ${rel}`)
    }
    if (!statSync(abs).isFile()) {
      throw new Error(`Workflow-skill source path is not a file: ${rel}`)
    }

    const body = extractMarkdownBody(readFileSync(abs, 'utf-8'))
    if (!body.trim()) {
      throw new Error(`Workflow-skill source file is empty: ${rel}`)
    }
  }
}

function resolvePackagePath(stagingDir: string, rel: string): string {
  const normalizedRel = normalizePackageRel(rel)
  const abs = resolve(stagingDir, normalizedRel)
  if (!isPathInside(stagingDir, abs)) {
    throw new Error(`Contribution source path escapes the package root: ${rel}`)
  }
  return abs
}

function normalizePackageRel(rel: string): string {
  if (isAbsolute(rel)) {
    throw new Error(`Contribution source path escapes the package root: ${rel}`)
  }
  const normalized = normalize(rel).replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`Contribution source path escapes the package root: ${rel}`)
  }
  return normalized
}

function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function extractMarkdownBody(raw: string): string {
  return splitFrontmatter(raw.replace(/\r\n/g, '\n')).body
}

function deriveWorkflowId(definition: WorkflowDefinition, fallbackBase: string): string {
  if (typeof definition.id === 'string' && definition.id.length > 0) return definition.id
  if (typeof definition.name === 'string' && definition.name.length > 0) {
    return definition.name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
      .replace(/-$/, '')
  }
  return fallbackBase
}
