/**
 * Managed-block composer (layered-context spec).
 *
 * Every workspace file owns at most ONE Bakin-managed block
 * (`<!-- bakin:managed:start/end -->`). This module composes that block's
 * body from the resolved context layers:
 *
 *   AGENTS.md   = global + team + package template
 *   SOUL.md     = package template + lessons (catalog + enabled bodies)
 *   IDENTITY.md = package template
 *   TOOLS.md    = package template
 *
 * Unmanaged agents (no package) still get an AGENTS.md block when global or
 * team context exists — the package section is simply absent.
 *
 * `<!-- bakin-section: ... -->` separators inside the block are
 * readability-only; the composer regenerates them wholesale. Only the outer
 * markers carry lifecycle semantics.
 *
 * Pure module: string in, string out. Deterministic — identical inputs
 * produce identical bytes, so callers may compare composed output by sha.
 * Layer resolution (reading context files, lockfiles, manifests) belongs to
 * callers.
 */
import { injectBlock } from './managed-blocks'

export const MANAGED_BLOCK_ID = 'managed'

export const PROVENANCE_COMMENT =
  '<!-- Managed by Bakin. Do not edit inside this block — it is rewritten on sync. Write above or below the block instead. -->'

export type ComposableFile = 'SOUL.md' | 'AGENTS.md' | 'IDENTITY.md' | 'TOOLS.md'

export interface LessonEntry {
  id: string
  title: string
  enabled: boolean
  /** Lesson markdown body; required (and only used) when enabled. */
  body?: string
}

export interface ComposeInputs {
  /** Effective content of the global context file. AGENTS.md only. */
  global?: string
  /**
   * Effective content of the agent's role context file (built-in role layer:
   * 'orchestrator' for the main agent, 'subagent' for everyone else).
   * AGENTS.md only.
   */
  role?: { id: string; content: string }
  /** Effective content of the agent's team context file. AGENTS.md only. */
  team?: { id: string; content: string }
  /** Package workspace template for this file. Managed agents only. */
  packageTemplate?: { packageId: string; content: string }
  /** Package lessons. SOUL.md only. */
  lessons?: { packageId: string; entries: LessonEntry[] }
}

interface Section {
  label: string
  content: string
}

function normalized(text: string | undefined): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
}

function renderLessonsSection(lessons: NonNullable<ComposeInputs['lessons']>): string | null {
  if (lessons.entries.length === 0) return null
  const catalog = [
    `> Lessons from agent-package \`${lessons.packageId}\`. Toggle via \`bakin agents lessons enable|disable\`.`,
    '',
    ...lessons.entries.map(
      (l) => `- [${l.enabled ? 'x' : ' '}] **${l.title}** (\`${l.id}\`)`,
    ),
  ].join('\n')
  const bodies = lessons.entries
    .filter((l) => l.enabled)
    .map((l) => normalized(l.body))
    .filter((b): b is string => b !== null)
  return [catalog, ...bodies].join('\n\n')
}

function sectionsFor(file: ComposableFile, inputs: ComposeInputs): Section[] {
  const sections: Section[] = []
  const pkg = normalized(inputs.packageTemplate?.content)

  if (file === 'AGENTS.md') {
    const global = normalized(inputs.global)
    if (global) sections.push({ label: 'global', content: global })
    const role = normalized(inputs.role?.content)
    if (role && inputs.role) sections.push({ label: `role:${inputs.role.id}`, content: role })
    const team = normalized(inputs.team?.content)
    if (team && inputs.team) sections.push({ label: `team:${inputs.team.id}`, content: team })
    if (pkg) sections.push({ label: 'package', content: pkg })
    return sections
  }

  if (pkg) sections.push({ label: 'package', content: pkg })
  if (file === 'SOUL.md' && inputs.lessons) {
    const lessons = renderLessonsSection(inputs.lessons)
    if (lessons) sections.push({ label: 'lessons', content: lessons })
  }
  return sections
}

/**
 * Compose the managed-block body for a workspace file. Returns null when no
 * layer contributes content — meaning the file should carry no managed block.
 */
export function composeManagedBlock(
  file: ComposableFile,
  inputs: ComposeInputs,
): string | null {
  const sections = sectionsFor(file, inputs)
  if (sections.length === 0) return null
  const parts = sections.map(
    (s) => `<!-- bakin-section: ${s.label} -->\n${s.content}`,
  )
  return [PROVENANCE_COMMENT, ...parts].join('\n\n')
}

/**
 * Inject or replace the managed block in a file's content. Content outside
 * the markers is preserved exactly. Replacing with an identical body is a
 * byte-level no-op.
 */
export function composeFileContent(existing: string, blockBody: string): string {
  return injectBlock(existing, MANAGED_BLOCK_ID, blockBody)
}
