/**
 * Skill file loader — multi-source resolution.
 *
 * Skills can come from three sources (checked in this order):
 * 1. Plugin-registered skills (in-memory, from registerSkill())
 * 2. User skills ({CONTENT_DIR}/workflows/skills/{name}.md)
 * 3. Returns null if not found in any source
 *
 * Frontmatter carries metadata (name, output_schema); the markdown body
 * becomes the agent's step instructions.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import type { SkillDefinition } from '../types'
import { getContentDir } from './content-dir'
import { getPluginSkills } from '../../../src/lib/plugin-registry'

const skillCache = new Map<string, SkillDefinition | null>()

const SCOPE_FENCE = '\n\n---\n**SCOPE BOUNDARY:** Your scope is LIMITED to the instructions above. Do not generate deliverables not specified above. Submit your output via the step/complete API — this is the ONLY way your work enters the system.'

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
 * Load a skill from a markdown file on disk.
 */
function loadSkillFromFile(name: string, dir: string): SkillDefinition | null {
  const filePath = join(dir, 'workflows', 'skills', `${name}.md`)

  if (!existsSync(filePath)) return null

  const content = readFileSync(filePath, 'utf-8')
  const { frontmatter, body } = parseSkillFile(content)

  const skill: SkillDefinition = {
    name: (frontmatter.name as string) || name,
    instructions: body + SCOPE_FENCE,
  }

  if (frontmatter.output_schema) {
    skill.output_schema = frontmatter.output_schema as Record<string, unknown>
  }

  return skill
}

/**
 * Load a skill by name using multi-source resolution.
 *
 * Resolution order:
 * 1. Plugin-registered skills (in-memory)
 * 2. User skill files ({CONTENT_DIR}/workflows/skills/{name}.md)
 * 3. null if not found
 */
export function loadSkill(name: string, contentDir?: string): SkillDefinition | null {
  const cacheKey = `${contentDir || ''}:${name}`
  if (skillCache.has(cacheKey)) {
    return skillCache.get(cacheKey)!
  }

  // Source 1: Plugin-registered skills
  const pluginSkills = getPluginSkills()
  const pluginSkill = pluginSkills.get(name)
  if (pluginSkill) {
    // Ensure scope fence is appended if not already present
    const skill: SkillDefinition = {
      ...pluginSkill,
      instructions: pluginSkill.instructions.includes('SCOPE BOUNDARY')
        ? pluginSkill.instructions
        : pluginSkill.instructions + SCOPE_FENCE,
    }
    skillCache.set(cacheKey, skill)
    return skill
  }

  // Source 2: User skill files on disk
  const dir = contentDir || getContentDir()
  const fileSkill = loadSkillFromFile(name, dir)
  if (fileSkill) {
    skillCache.set(cacheKey, fileSkill)
    return fileSkill
  }

  // Not found
  skillCache.set(cacheKey, null)
  return null
}

/**
 * Get metadata about all available skills from all sources.
 * Used by the health dashboard registry endpoint.
 */
export function listAllSkills(contentDir?: string): Array<{
  name: string
  source: string
  path?: string
}> {
  const results: Array<{ name: string; source: string; path?: string }> = []
  const seen = new Set<string>()

  // Plugin-registered skills
  const pluginSkills = getPluginSkills()
  for (const [name, skill] of pluginSkills) {
    results.push({ name, source: skill.source || 'plugin' })
    seen.add(name)
  }

  // User skill files
  const dir = contentDir || getContentDir()
  const skillsDir = join(dir, 'workflows', 'skills')
  if (existsSync(skillsDir)) {
    const { readdirSync } = require('fs') as typeof import('fs')
    try {
      const files = readdirSync(skillsDir)
      for (const file of files) {
        if (!file.endsWith('.md')) continue
        const name = file.replace(/\.md$/, '')
        if (!seen.has(name)) {
          results.push({ name, source: 'user', path: join(skillsDir, file) })
          seen.add(name)
        }
      }
    } catch {
      // skills directory not readable
    }
  }

  return results
}

/**
 * Invalidate the skill cache (called when skill files change on disk).
 */
export function invalidateSkillCache(): void {
  skillCache.clear()
}
