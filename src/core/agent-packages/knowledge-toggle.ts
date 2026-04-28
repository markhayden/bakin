/**
 * Focused mutator for `bakin agents knowledge {enable,disable,list}`.
 *
 * Toggling a single lesson on/off doesn't justify a full re-project — the
 * knowledge-marker block in SOUL.md is the only thing that changes. This
 * helper updates that block + the lockfile's `knowledgeEnabled` array, and
 * leaves the rest of the projection alone.
 *
 * Reads the lesson body fresh from the package's installed source dir so
 * the marker injection always reflects the file content currently on disk
 * (handles the case where a `bakin agents update` ran between toggles).
 */
import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { createLogger } from '../logger'
import { getContentDir } from '../content-dir'
import { appendAudit } from '../audit'
import { getRuntimeAdapter } from '../runtime-registry'
import {
  type AgentManifest,
  type Manifest,
  parseManifest,
} from '../../../packages/core/src/agent-packages/manifest'
import {
  addPackage,
  readLockfile,
  writeLockfile,
} from '../../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import {
  injectBlock,
  removeBlock,
} from '../../../packages/core/src/agent-packages/managed-blocks'

const log = createLogger('agent-pkg:knowledge')

export interface KnowledgeLessonInfo {
  lessonId: string
  title: string
  tags: string[]
  defaultEnabled: boolean
  enabled: boolean
  /** Path the lesson body lives at in the installed package source dir. */
  sourcePath: string
}

/**
 * List every lesson the package contributes, with current enabled state
 * cross-referenced against the lockfile. Reads frontmatter for title +
 * tags + defaultEnabled.
 */
export function listKnowledge(packageId: string): KnowledgeLessonInfo[] {
  const lock = readLockfile()
  const entry = lock.packages[packageId]
  if (!entry) {
    throw new Error(`Package "${packageId}" is not installed.`)
  }

  const installDir = getPackageSourceDir(getContentDir(), entry.kind, packageId, entry.version)
  const manifest = readPackageManifest(installDir)
  if (!manifest || manifest.kind !== 'agent') return []

  const knowledge = manifest.contributions.knowledge ?? []
  const enabledSet = new Set(entry.knowledgeEnabled ?? [])

  return knowledge.map((rel) => parseLessonFile(join(installDir, rel), rel, enabledSet))
}

export interface ToggleResult {
  packageId: string
  lessonId: string
  enabled: boolean
  changed: boolean
}

/**
 * Enable or disable a single lesson. Idempotent — toggling an already-on
 * lesson on returns `changed: false` with no writes.
 */
export async function setKnowledgeEnabled(
  packageId: string,
  lessonId: string,
  enabled: boolean,
): Promise<ToggleResult> {
  const lock = readLockfile()
  const entry = lock.packages[packageId]
  if (!entry) {
    throw new Error(`Package "${packageId}" is not installed.`)
  }
  if (entry.kind !== 'agent') {
    throw new Error(
      `Package "${packageId}" is a ${entry.kind} — knowledge toggling only applies to agent packages.`,
    )
  }
  if (!entry.agentId) {
    throw new Error(`Lockfile entry for "${packageId}" is missing agentId — cannot resolve SOUL.md target.`)
  }

  const installDir = getPackageSourceDir(getContentDir(), entry.kind, packageId, entry.version)
  const manifest = readPackageManifest(installDir)
  if (!manifest || manifest.kind !== 'agent') {
    throw new Error(`Package source for "${packageId}" is missing or malformed.`)
  }

  const lessonPaths = (manifest.contributions.knowledge ?? []).map((rel) => ({
    rel,
    abs: join(installDir, rel),
    lessonId: basename(rel).replace(/\.md$/i, ''),
  }))
  const target = lessonPaths.find((l) => l.lessonId === lessonId)
  if (!target) {
    throw new Error(
      `Lesson "${lessonId}" is not contributed by package "${packageId}". ` +
        `Available: ${lessonPaths.map((l) => l.lessonId).join(', ')}`,
    )
  }

  const currentEnabled = new Set(entry.knowledgeEnabled ?? [])
  const wasEnabled = currentEnabled.has(lessonId)
  if (wasEnabled === enabled) {
    return { packageId, lessonId, enabled, changed: false }
  }

  // Mutate the SOUL.md through the runtime workspace API.
  const runtime = getRuntimeAdapter()
  const soulFile = await runtime.agents.readWorkspaceFile(entry.agentId, 'SOUL.md')
  if (!soulFile) {
    throw new Error(`SOUL.md missing for agent "${entry.agentId}" in the runtime workspace.`)
  }
  if (soulFile.metadata?.userEdited === true) {
    throw new Error(
      `SOUL.md is marked .userEdited — refusing to mutate. Remove the sentinel to re-enable knowledge toggling.`,
    )
  }

  const blockId = `knowledge:${packageId}:${lessonId}`
  let soul = soulFile.content
  if (enabled) {
    const lesson = parseLessonFile(target.abs, target.rel, currentEnabled)
    soul = injectBlock(soul, blockId, lesson.body)
    currentEnabled.add(lessonId)
  } else {
    soul = removeBlock(soul, blockId)
    currentEnabled.delete(lessonId)
  }

  // Refresh the catalog block to reflect the new enabled state
  const allLessons = lessonPaths.map((l) => parseLessonFile(l.abs, l.rel, currentEnabled))
  soul = injectBlock(soul, 'knowledge-catalog', buildCatalogBody(packageId, allLessons, currentEnabled))

  await runtime.agents.writeWorkspaceFile(entry.agentId, { path: 'SOUL.md', content: soul })

  // Update lockfile
  const nextEntry = { ...entry, knowledgeEnabled: Array.from(currentEnabled).sort() }
  writeLockfile(addPackage(lock, packageId, nextEntry))

  appendAudit(
    getContentDir(),
    enabled ? 'agent_pkg.knowledge_enabled' : 'agent_pkg.knowledge_disabled',
    entry.agentId,
    { packageId, lessonId },
    'cli',
  )

  log.info(`Knowledge ${enabled ? 'enabled' : 'disabled'}`, {
    packageId,
    lessonId,
    agentId: entry.agentId,
  })

  return { packageId, lessonId, enabled, changed: true }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function readPackageManifest(installDir: string): Manifest | null {
  const path = join(installDir, 'bakin-package.json')
  if (!existsSync(path)) return null
  try {
    return parseManifest(JSON.parse(readFileSync(path, 'utf-8')))
  } catch {
    return null
  }
}

interface ParsedLesson {
  lessonId: string
  title: string
  tags: string[]
  defaultEnabled: boolean
  body: string
  sourcePath: string
}

function parseLessonFile(
  absPath: string,
  packageRel: string,
  enabled: Set<string>,
): ParsedLesson & { enabled: boolean } {
  const lessonId = basename(packageRel).replace(/\.md$/i, '')
  let title = lessonId
  let tags: string[] = []
  let defaultEnabled = false
  let body = ''

  if (existsSync(absPath)) {
    const raw = readFileSync(absPath, 'utf-8')
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
    if (match) {
      body = match[2].trim()
      for (const line of match[1].split('\n')) {
        const trimmed = line.trim()
        if (trimmed.startsWith('title:')) {
          title = trimmed.slice('title:'.length).trim().replace(/^['"]|['"]$/g, '')
        } else if (trimmed.startsWith('defaultEnabled:')) {
          defaultEnabled = trimmed.slice('defaultEnabled:'.length).trim() === 'true'
        } else if (trimmed.startsWith('tags:')) {
          const rest = trimmed.slice('tags:'.length).trim()
          if (rest.startsWith('[') && rest.endsWith(']')) {
            tags = rest
              .slice(1, -1)
              .split(',')
              .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
              .filter((t) => t.length > 0)
          }
        }
      }
    } else {
      body = raw.trim()
    }
  }

  return {
    lessonId,
    title,
    tags,
    defaultEnabled,
    body,
    sourcePath: absPath,
    enabled: enabled.has(lessonId),
  }
}

function buildCatalogBody(
  packageId: string,
  lessons: Array<{ lessonId: string; title: string }>,
  enabled: Set<string>,
): string {
  if (lessons.length === 0) {
    return `> No knowledge available from ${packageId}.`
  }
  const lines = [
    `> Knowledge available from agent-package \`${packageId}\`. ` +
      `Toggle individual lessons via \`bakin agents knowledge enable|disable\`.`,
    '',
  ]
  for (const k of lessons) {
    const mark = enabled.has(k.lessonId) ? '[x]' : '[ ]'
    lines.push(`- ${mark} **${k.title}** (\`${k.lessonId}\`)`)
  }
  return lines.join('\n')
}

// Reference type imports so unused-import linting doesn't trip
void ((null as unknown) as AgentManifest)
void ((null as unknown) as KnowledgeLessonInfo)
