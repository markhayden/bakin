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
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'

import type { AgentRuntimeAdapter, RuntimeSkill } from '@bakin/core/adapters/runtime'
import { isExecutableSkillFile, isSafeSkillFilePath, readSkillTree } from '@bakin/core/adapters/runtime'
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

/**
 * Metadata sidecars, mirroring the OpenClaw adapter's convention:
 * `.installedBy` (JSON install marker) + `.userEdited` (bare sentinel).
 * Dropping these on write broke plugin-asset installs on Pi — installed
 * skills could never read back as installed (always "drifted"), and user
 * edits could never lock a projection.
 */
const SKILL_SIDECARS = new Set(['.installedBy', '.userEdited'])

function readInstalledBy(dir: string): unknown {
  const path = join(dir, '.installedBy')
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown
  } catch {
    // Corrupt marker reads as "not installed by us" — the plugin-assets
    // check then reports drift and a reinstall rewrites the sidecar.
    return undefined
  }
}

function readSkill(name: string, agentId?: string): RuntimeSkill | null {
  const dir = skillDir(name, agentId)
  const skillMd = join(dir, 'SKILL.md')
  if (!existsSync(skillMd)) return null
  // SKILL.md rides the files map (OpenClaw parity): consumers that hash,
  // snapshot, or carry skill.files get the COMPLETE skill — excluding it
  // made every Pi-hosted skill read permanently drifted in the sync
  // scanner and dropped instructions from uninstall snapshots. The tree
  // read is recursive (scripts/, references/) and sidecar-excluding.
  const files = readSkillTree(dir)
  const installedBy = readInstalledBy(dir)
  return {
    name,
    path: dir,
    instructions: readFileSync(skillMd, 'utf-8'),
    ...(Object.keys(files).length > 0 ? { files } : {}),
    metadata: {
      scope: agentId ? 'agent' : 'global',
      updatedAt: statSync(skillMd).mtime.toISOString(),
      ...(installedBy !== undefined ? { installedBy } : {}),
      userEdited: existsSync(join(dir, '.userEdited')),
    },
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
      // Validate EVERY file path before the first write: a mid-loop throw
      // used to leave a half-written directory that skills.list would then
      // report as a valid skill. Nested paths (scripts/, references/) are
      // allowed; traversal/absolute/sidecar names are not.
      const files = Object.entries(skill.files ?? {})
      for (const [fileName] of files) {
        const base = fileName.split('/').pop() ?? fileName
        if (!isSafeSkillFilePath(fileName) || SKILL_SIDECARS.has(base)) {
          throw new Error(`adapter-pi: invalid skill file name "${fileName}"`)
        }
      }
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), skill.instructions ?? '')
      for (const [fileName, content] of files) {
        const target = join(dir, fileName)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
        if (isExecutableSkillFile(fileName, content)) chmodSync(target, 0o755)
      }
      const installedBy = skill.metadata?.installedBy
      if (installedBy !== undefined && installedBy !== null) {
        writeFileSync(join(dir, '.installedBy'), JSON.stringify(installedBy, null, 2))
      } else {
        rmSync(join(dir, '.installedBy'), { force: true })
      }
    },

    async remove(name: string, agentId?: string): Promise<void> {
      rmSync(skillDir(name, agentId), { recursive: true, force: true })
    },
  }
}
