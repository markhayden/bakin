/**
 * Skill file loader — parses markdown files with YAML frontmatter.
 *
 * Skills are stored as markdown files in {CONTENT_DIR}/workflows/skills/.
 * Frontmatter carries metadata (name, output_schema); the markdown body
 * becomes the agent's step instructions.
 *
 * Resolution order:
 * 1. {CONTENT_DIR}/workflows/skills/{name}.md
 * 2. Returns null if not found
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import type { SkillDefinition } from './types'
import { getContentDir } from './content-dir'

const skillCache = new Map<string, SkillDefinition | null>()

/**
 * Parse a skill markdown file into frontmatter + body.
 */
function parseSkillFile(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content.trim() }
  }

  let frontmatter: Record<string, unknown> = {}
  try {
    frontmatter = (yaml.load(match[1]) as Record<string, unknown>) || {}
  } catch {
    // If frontmatter parsing fails, treat entire content as body
    return { frontmatter: {}, body: content.trim() }
  }

  return { frontmatter, body: match[2].trim() }
}

/**
 * Load a skill file by name.
 * Returns parsed SkillDefinition or null if the file doesn't exist.
 */
export function loadSkill(name: string, contentDir?: string): SkillDefinition | null {
  const cacheKey = `${contentDir || ''}:${name}`
  if (skillCache.has(cacheKey)) {
    return skillCache.get(cacheKey)!
  }

  const dir = contentDir || getContentDir()
  const filePath = join(dir, 'workflows', 'skills', `${name}.md`)

  if (!existsSync(filePath)) {
    skillCache.set(cacheKey, null)
    return null
  }

  const content = readFileSync(filePath, 'utf-8')
  const { frontmatter, body } = parseSkillFile(content)

  const skill: SkillDefinition = {
    name: (frontmatter.name as string) || name,
    instructions: body,
  }

  if (frontmatter.output_schema) {
    skill.output_schema = frontmatter.output_schema as Record<string, unknown>
  }

  skillCache.set(cacheKey, skill)
  return skill
}

/**
 * Invalidate the skill cache (called when skill files change on disk).
 */
export function invalidateSkillCache(): void {
  skillCache.clear()
}
