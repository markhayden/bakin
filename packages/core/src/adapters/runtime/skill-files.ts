/**
 * Shared skill-file helpers for runtime adapters.
 *
 * Skills are directories of text files (SKILL.md + support files, possibly
 * nested — scripts/, references/). Every adapter's skills surface uses the
 * same path-safety rule, the same recursive tree read, and the same
 * "is this a script" test for setting the executable bit on projection —
 * hub bundles ship real shell/python scripts that agents invoke directly.
 */
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/** Relative path inside a skill dir: no absolute, no backslash, no `..`/empty segments. */
export function isSafeSkillFilePath(path: string): boolean {
  return Boolean(path)
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.split('/').some((part) => part === '..' || part === '')
}

/** Metadata sidecars — never part of a skill's file map. */
export const SKILL_SIDECAR_NAMES = new Set(['.installedBy', '.userEdited'])

const SCRIPT_EXTENSIONS = new Set(['sh', 'bash', 'zsh', 'py', 'js', 'mjs', 'cjs', 'rb', 'pl'])

/** Scripts get the executable bit at projection: shebang or a script extension. */
export function isExecutableSkillFile(path: string, content: string): boolean {
  if (content.startsWith('#!')) return true
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  return SCRIPT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

/**
 * Read a skill directory into a relative-path→content map, skipping
 * symlinks and the metadata sidecars (`.installedBy`/`.userEdited`) at any
 * depth. Unreadable roots read as empty.
 */
export function readSkillTree(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string, prefix = ''): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs, rel)
      } else if (entry.isFile()) {
        if (entry.name === '.installedBy' || entry.name === '.userEdited') continue
        files[rel] = readFileSync(abs, 'utf-8')
      }
    }
  }
  try {
    walk(root)
  } catch {
    return {}
  }
  return files
}
