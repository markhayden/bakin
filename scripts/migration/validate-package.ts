#!/usr/bin/env bun
/**
 * scripts/migration/validate-package.ts
 *
 * Validates a candidate agent-package directory:
 *   1. bakin-package.json parses against the zod schema
 *   2. Every path listed in `contributions.*` exists on disk
 *
 * Used during the conversion phase (PLAN.md B-2 and G-1..G-7) and as a
 * pre-flight check anyone authoring a package can run locally before
 * `bakin agents install`. Read-only.
 *
 * Usage:
 *   bun scripts/migration/validate-package.ts <path-to-package-dir>
 *   bun scripts/migration/validate-package.ts ../bakin-bits-official/agents/pixel
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import {
  type Manifest,
  formatManifestError,
  safeParseManifest,
} from '../../packages/core/src/agent-packages/manifest'

interface ValidationResult {
  packageDir: string
  manifestValid: boolean
  manifestErrors: string[]
  missingPaths: string[]
  warnings: string[]
}

function getContributionPaths(manifest: Manifest): string[] {
  const all: string[] = []

  // Access manifest.contributions inside each branch so the discriminated
  // union narrows correctly — extracting `c = manifest.contributions` outside
  // the conditionals leaves it as the cross-kind union with no shared keys.
  if (manifest.kind === 'agent') {
    const c = manifest.contributions
    all.push(...(c.workspaceFiles ?? []))
    all.push(...(c.skills ?? []))
    all.push(...(c.workflows ?? []))
    all.push(...(c.workflowSkills ?? []))
    all.push(...(c.lessons ?? []))
    all.push(...(c.assets ?? []))
  } else if (manifest.kind === 'skill-pack') {
    const c = manifest.contributions
    all.push(...c.skills)
    all.push(...(c.assets ?? []))
  } else if (manifest.kind === 'workflow-pack') {
    const c = manifest.contributions
    all.push(...(c.workflows ?? []))
    all.push(...(c.workflowSkills ?? []))
    all.push(...(c.assets ?? []))
  } else if (manifest.kind === 'lesson-pack') {
    const c = manifest.contributions
    all.push(...c.lessons)
    all.push(...(c.assets ?? []))
  }

  return all
}

function validatePackage(packageDir: string): ValidationResult {
  const result: ValidationResult = {
    packageDir,
    manifestValid: false,
    manifestErrors: [],
    missingPaths: [],
    warnings: [],
  }

  const manifestPath = join(packageDir, 'bakin-package.json')
  if (!existsSync(manifestPath)) {
    result.manifestErrors.push(`bakin-package.json not found in ${packageDir}`)
    return result
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (err) {
    result.manifestErrors.push(`bakin-package.json is not valid JSON: ${String(err)}`)
    return result
  }

  const parseResult = safeParseManifest(parsed)
  if (!parseResult.success) {
    result.manifestErrors.push(formatManifestError(parseResult.error))
    return result
  }

  result.manifestValid = true
  const manifest = parseResult.data
  for (const rel of getContributionPaths(manifest)) {
    const abs = join(packageDir, rel)
    if (!existsSync(abs)) {
      result.missingPaths.push(rel)
    }
  }

  // Soft warnings
  if (manifest.kind === 'agent') {
    const installEnable = manifest.install.enableLessons ?? []
    const declared = (manifest.contributions.lessons ?? []).map((p) => {
      // Lesson id = filename without extension (matches phase F-4 indexing convention)
      const base = p.split('/').pop() ?? p
      return base.replace(/\.md$/, '')
    })
    for (const lesson of installEnable) {
      if (!declared.includes(lesson)) {
        result.warnings.push(
          `install.enableLessons references "${lesson}" but no matching lesson file was contributed`,
        )
      }
    }
  }

  return result
}

function main(): void {
  const arg = process.argv[2]
  if (!arg) {
    console.error('Usage: bun scripts/migration/validate-package.ts <path-to-package-dir>')
    process.exit(2)
  }

  const packageDir = resolve(arg)
  if (!existsSync(packageDir) || !statSync(packageDir).isDirectory()) {
    console.error(`Not a directory: ${packageDir}`)
    process.exit(2)
  }

  const result = validatePackage(packageDir)
  console.log(JSON.stringify(result, null, 2))

  const ok = result.manifestValid && result.missingPaths.length === 0
  process.exit(ok ? 0 : 1)
}

if (import.meta.main) {
  main()
}

export { validatePackage }
export type { ValidationResult }
