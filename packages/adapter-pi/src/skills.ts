/**
 * skills.* contract implementation over Pi's native skill layout.
 *
 * Pi discovers skills as directories containing SKILL.md:
 *   - global:   <pi-home>/agent/skills/<name>/SKILL.md
 *   - per-agent: <workspace>/.pi/skills/<name>/SKILL.md (project-local
 *     discovery relative to the session cwd = the agent workspace).
 *
 * `agentId` selects the scope: absent → global, present → that agent's
 * workspace-local skills.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'

import type { AgentRuntimeAdapter, RuntimeSkill } from '@bakin/core/adapters/runtime'
import { getAgentWorkspaceDir, getPiPath } from './home'
import { assertValidAgentId } from './registry'

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/i

function skillsRoot(agentId?: string): string {
  if (!agentId) return getPiPath('agent', 'skills')
  assertValidAgentId(agentId)
  return join(getAgentWorkspaceDir(agentId), '.pi', 'skills')
}

function skillDir(name: string, agentId?: string): string {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`adapter-pi: invalid skill name "${name}"`)
  }
  return join(skillsRoot(agentId), name)
}

function readSkill(name: string, agentId?: string): RuntimeSkill | null {
  const dir = skillDir(name, agentId)
  const skillMd = join(dir, 'SKILL.md')
  if (!existsSync(skillMd)) return null
  const files: Record<string, string> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'SKILL.md') continue
    files[entry.name] = readFileSync(join(dir, entry.name), 'utf-8')
  }
  return {
    name,
    path: dir,
    instructions: readFileSync(skillMd, 'utf-8'),
    ...(Object.keys(files).length > 0 ? { files } : {}),
    metadata: { scope: agentId ? 'agent' : 'global', updatedAt: statSync(skillMd).mtime.toISOString() },
  }
}

export function createSkillsSurface(): AgentRuntimeAdapter['skills'] {
  return {
    async list(agentId?: string): Promise<RuntimeSkill[]> {
      const root = skillsRoot(agentId)
      if (!existsSync(root)) return []
      const out: RuntimeSkill[] = []
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const skill = readSkill(entry.name, agentId)
        if (skill) out.push(skill)
      }
      return out.sort((a, b) => a.name.localeCompare(b.name))
    },

    async get(name: string, agentId?: string): Promise<RuntimeSkill | null> {
      return readSkill(name, agentId)
    },

    async write(skill: RuntimeSkill, agentId?: string): Promise<void> {
      const dir = skillDir(skill.name, agentId)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), skill.instructions ?? '')
      for (const [fileName, content] of Object.entries(skill.files ?? {})) {
        if (fileName.includes('/') || fileName.includes('..')) {
          throw new Error(`adapter-pi: invalid skill file name "${fileName}"`)
        }
        writeFileSync(join(dir, fileName), content)
      }
    },

    async remove(name: string, agentId?: string): Promise<void> {
      rmSync(skillDir(name, agentId), { recursive: true, force: true })
    },
  }
}
