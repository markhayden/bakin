/**
 * Generic plugin-skill auto-loader.
 *
 * Plugins ship workflow skills as `defaults/workflow-skills/*.md` files
 * alongside their server code. After a plugin's `activate(ctx)` returns,
 * the registry calls `loadPluginSkills` so every skill file gets parsed
 * and registered through `ctx.registerSkill` — no per-plugin glue.
 *
 * Each `.md` file may carry YAML frontmatter (`name`, `output_schema`, ...)
 * followed by markdown that becomes the agent's instructions. The skill
 * resolution order in `plugins/workflows/lib/skill-loader.ts` already
 * checks the in-memory plugin registry first, so auto-registered skills
 * resolve identically to explicit `ctx.registerSkill()` calls.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import type { PluginContext, SkillDefinition } from '@bakin/core/plugin-types'

export interface LoadPluginSkillsResult {
  registered: string[]
  skipped: { file: string; error: string }[]
}

interface ParsedSkill {
  frontmatter: Record<string, unknown>
  body: string
}

function parseSkillFile(content: string): ParsedSkill {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return { frontmatter: {}, body: content.trim() }
  }
  let frontmatter: Record<string, unknown> = {}
  try {
    frontmatter = (yaml.load(match[1]) as Record<string, unknown>) || {}
  } catch {
    return { frontmatter: {}, body: content.trim() }
  }
  return { frontmatter, body: match[2].trim() }
}

export function loadPluginSkills(
  pluginPath: string,
  ctx: PluginContext,
  log: { warn: (msg: string, meta?: Record<string, unknown>) => void },
): LoadPluginSkillsResult {
  const result: LoadPluginSkillsResult = { registered: [], skipped: [] }
  const skillsDir = join(pluginPath, 'defaults', 'workflow-skills')
  if (!existsSync(skillsDir)) return result

  const files = readdirSync(skillsDir).filter((f) => f.endsWith('.md'))

  for (const file of files) {
    const filenameId = file.replace(/\.md$/, '')
    try {
      const sourcePath = join(skillsDir, file)
      const raw = readFileSync(sourcePath, 'utf-8')
      const { frontmatter, body } = parseSkillFile(raw)

      const skill: SkillDefinition = {
        name: (frontmatter.name as string) || filenameId,
        instructions: body,
        sourcePath,
      }
      if (frontmatter.output_schema) {
        skill.output_schema = frontmatter.output_schema as Record<string, unknown>
      }

      ctx.registerSkill(skill)
      result.registered.push(filenameId)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      result.skipped.push({ file, error })
      log.warn(`Failed to auto-register plugin skill "${file}"`, { error })
    }
  }

  return result
}
