#!/usr/bin/env bun

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import Ajv from 'ajv'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const EXCEPTIONS_PATH = join(REPO_ROOT, 'design-system/exceptions.json')
const EXCEPTIONS_SCHEMA_PATH = join(REPO_ROOT, 'design-system/exceptions.schema.json')

export type UiConformanceMode = 'quick' | 'full'

export interface UiConformanceStep {
  label: string
  command: string[]
}

export interface UiExceptionDocument {
  schemaVersion: 1
  policy: string
  exceptions: Array<{
    id: string
    status: 'approved-temporary'
    scope: string[]
    closestPattern: {
      storyPath: string
      storyExport: string
    }
    mismatch: string
    compositionLimit: string
    alternative: string
    safeguards: {
      accessibility: string
      responsiveness: string
      routing: string
      isolation: string
    }
    approvedBy: string
    approvedOn: string
    approvalEvidence: string
    reviewBy: string
    removalCondition: string
  }>
}

const QUICK_COMMANDS: readonly UiConformanceStep[] = [
  { label: 'Generated design tokens', command: ['bun', 'run', 'ui:tokens:check'] },
  { label: 'Focused SDK public API', command: ['bun', 'run', 'ui:public-api:check'] },
  { label: 'Official core and Bits census', command: ['bun', 'run', 'ui:census:check'] },
  { label: 'Legacy style ratchet', command: ['bun', 'run', 'ui:legacy-styles:check'] },
  { label: 'UI architecture contracts', command: ['bun', 'test', 'tests/ui/architecture', '--isolate'] },
  { label: 'TypeScript', command: ['bun', 'run', 'typecheck'] },
] as const

const FULL_ONLY_COMMANDS: readonly UiConformanceStep[] = [
  { label: 'Lint', command: ['bun', 'run', 'lint'] },
  { label: 'Canonical stylesheet build', command: ['bun', 'run', 'build:css'] },
  { label: 'Repository tests', command: ['bun', 'run', 'test'] },
  { label: 'Shared vendor build', command: ['bun', 'run', 'build:vendors'] },
  { label: 'Official core plugin build', command: ['bun', 'run', 'build:plugins'] },
  { label: 'Host shell build', command: ['bun', 'run', 'build:host-shell'] },
  { label: 'Browser payload ratchet', command: ['bun', 'run', 'ui:performance'] },
  { label: 'Deterministic public Storybook', command: ['bun', 'run', 'ui:build:public:verify'] },
  { label: 'Story accessibility and interactions', command: ['bun', 'run', 'ui:test:stories'] },
  { label: 'Canonical Chromium visuals', command: ['bun', 'run', 'ui:test:visual'] },
  { label: 'Cross-browser behavior', command: ['bun', 'run', 'ui:test:browsers'] },
  { label: 'Published docs and catalog', command: ['bun', 'run', 'docs:check'] },
] as const

export function conformanceCommands(mode: UiConformanceMode): UiConformanceStep[] {
  return mode === 'quick'
    ? QUICK_COMMANDS.map((step) => ({ ...step, command: [...step.command] }))
    : [...QUICK_COMMANDS, ...FULL_ONLY_COMMANDS].map((step) => ({ ...step, command: [...step.command] }))
}

function portablePath(root: string, path: string): string {
  return relative(root, path).split('\\').join('/')
}

function safelyResolveRepositoryPath(root: string, path: string): string | undefined {
  if (isAbsolute(path)) return undefined
  const resolved = resolve(root, path)
  const child = relative(root, resolved)
  if (child === '' || child.startsWith('..') || isAbsolute(child)) return undefined
  return resolved
}

function isInsideRepository(root: string, path: string): boolean {
  const child = relative(root, path)
  return child !== '' && !child.startsWith('..') && !isAbsolute(child)
}

function schemaErrors(document: unknown): string[] {
  const schema = JSON.parse(readFileSync(EXCEPTIONS_SCHEMA_PATH, 'utf-8'))
  const validate = new Ajv({ allErrors: true }).compile(schema)
  if (validate(document)) return []
  return (validate.errors ?? []).map((error) => (
    `exceptions schema ${error.instancePath || '/'} ${error.message ?? 'is invalid'}`
  ))
}

function isConcreteExplanation(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[.!?]+$/g, '')
  const rejected = new Set([
    'custom',
    'it is custom',
    'easier',
    'it is easier',
    'looks better',
    'it looks better',
    'existing code',
    'because of existing code',
  ])
  return value.trim().length >= 40 && !rejected.has(normalized)
}

function storyExports(source: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\bexport\\s+(?:const|let|var|function|class)\\s+${escaped}\\b`).test(source)
}

function isValidIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Validate the durable exception ledger without claiming that static analysis
 * can infer design intent. The agent review owns judgment; this owns evidence.
 */
export function validateUiExceptionDocument(
  document: UiExceptionDocument,
  rootDir = REPO_ROOT,
  today = new Date(),
): string[] {
  const errors = schemaErrors(document)
  if (!document || typeof document !== 'object' || !Array.isArray(document.exceptions)) return errors

  const canonicalRoot = realpathSync(rootDir)
  const seenIds = new Set<string>()
  const todayIso = today.toISOString().slice(0, 10)

  for (const exception of document.exceptions) {
    if (!exception || typeof exception !== 'object') continue
    const prefix = exception.id ? `exception ${exception.id}` : 'exception <missing-id>'
    if (seenIds.has(exception.id)) errors.push(`${prefix} has a duplicate exception id`)
    seenIds.add(exception.id)

    if (!isConcreteExplanation(exception.mismatch ?? '')) {
      errors.push(`${prefix} mismatch must explain the exact unmet requirement; generic preference is not evidence`)
    }
    if (!isConcreteExplanation(exception.compositionLimit ?? '')) {
      errors.push(`${prefix} compositionLimit must explain why composition and documented escape hatches are insufficient`)
    }

    for (const scopePath of exception.scope ?? []) {
      const resolvedScope = safelyResolveRepositoryPath(canonicalRoot, scopePath)
      if (!resolvedScope) {
        errors.push(`${prefix} scope path escapes the repository: ${scopePath}`)
      } else if (!existsSync(resolvedScope)) {
        errors.push(`${prefix} scope path does not exist: ${portablePath(canonicalRoot, resolvedScope)}`)
      } else if (!isInsideRepository(canonicalRoot, realpathSync(resolvedScope))) {
        errors.push(`${prefix} scope path resolves outside the repository: ${scopePath}`)
      }
    }

    const storyPath = exception.closestPattern?.storyPath
    const resolvedStory = storyPath && safelyResolveRepositoryPath(canonicalRoot, storyPath)
    if (!resolvedStory) {
      errors.push(`${prefix} closestPattern story path escapes the repository: ${storyPath ?? '<missing>'}`)
    } else if (!existsSync(resolvedStory)) {
      errors.push(`${prefix} closestPattern story does not exist: ${storyPath}`)
    } else if (!isInsideRepository(canonicalRoot, realpathSync(resolvedStory))) {
      errors.push(`${prefix} closestPattern story resolves outside the repository: ${storyPath}`)
    } else if (!storyExports(readFileSync(resolvedStory, 'utf-8'), exception.closestPattern.storyExport)) {
      errors.push(`${prefix} storyExport ${exception.closestPattern.storyExport} is not exported by ${storyPath}`)
    }

    const approvedOnValid = isValidIsoCalendarDate(exception.approvedOn ?? '')
    const reviewByValid = isValidIsoCalendarDate(exception.reviewBy ?? '')
    if (exception.approvedOn && !approvedOnValid) {
      errors.push(`${prefix} approvedOn is not a valid calendar date`)
    }
    if (exception.reviewBy && !reviewByValid) {
      errors.push(`${prefix} reviewBy is not a valid calendar date`)
    }
    if (approvedOnValid && exception.approvedOn > todayIso) {
      errors.push(`${prefix} approvedOn is in the future (${exception.approvedOn})`)
    }
    if (approvedOnValid && reviewByValid && exception.reviewBy < exception.approvedOn) {
      errors.push(`${prefix} reviewBy precedes approvedOn`)
    }
    if (reviewByValid && exception.reviewBy < todayIso) {
      errors.push(`${prefix} reviewBy is expired (${exception.reviewBy}); renew or remove the deviation`)
    }
  }

  return [...new Set(errors)].sort((left, right) => left.localeCompare(right))
}

export function validateUiExceptionLedger(rootDir = REPO_ROOT, today = new Date()): string[] {
  const document = JSON.parse(readFileSync(join(rootDir, 'design-system/exceptions.json'), 'utf-8')) as UiExceptionDocument
  return validateUiExceptionDocument(document, rootDir, today)
}

async function runStep(step: UiConformanceStep): Promise<void> {
  console.log(`\n[ui:conformance] ${step.label}\n$ ${step.command.join(' ')}`)
  const child = Bun.spawn(step.command, {
    cwd: REPO_ROOT,
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`${step.label} failed with exit code ${exitCode}`)
}

function assertGovernance(): void {
  const errors = validateUiExceptionLedger(REPO_ROOT)
  if (errors.length > 0) {
    throw new Error(`UI design-system exception governance failed:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  }
  const count = (JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf-8')) as UiExceptionDocument).exceptions.length
  console.log(`UI exception governance valid (${count} active temporary exception${count === 1 ? '' : 's'}).`)
}

async function main(): Promise<void> {
  const [argument] = process.argv.slice(2)
  if (argument === 'governance') {
    assertGovernance()
    return
  }
  const mode = argument === '--quick' ? 'quick' : argument === '--full' ? 'full' : undefined
  if (!mode) throw new Error('Usage: bun run ui:conformance --quick | --full')

  assertGovernance()
  for (const step of conformanceCommands(mode)) await runStep(step)
  console.log(`\nUI conformance ${mode} suite passed.`)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
