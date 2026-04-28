import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'path'
import type { StorageAdapter } from '../plugin-types'

function assertSafePluginId(pluginId: string): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(pluginId)) {
    throw new Error(`Invalid plugin id for scoped storage: ${pluginId}`)
  }
}

export class ScopedPluginStorageAdapter implements StorageAdapter {
  readonly root: string
  private readonly pluginId: string

  constructor(contentDir: string, pluginId: string) {
    assertSafePluginId(pluginId)
    this.pluginId = pluginId
    this.root = join(contentDir, 'plugin-data', pluginId)
  }

  private resolve(relPath = ''): string {
    if (isAbsolute(relPath)) {
      throw new Error(`Plugin storage path must be relative: ${relPath}`)
    }
    const normalized = normalize(relPath)
    if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
      throw new Error(`Plugin storage path must not escape plugin root: ${relPath}`)
    }
    const resolved = join(this.root, normalized === '.' ? '' : normalized)
    const back = relative(this.root, resolved)
    if (back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) {
      throw new Error(`Plugin storage path must not escape plugin root: ${relPath}`)
    }
    return resolved
  }

  read(path: string): string | null {
    const file = this.resolve(path)
    if (!existsSync(file)) return null
    const stat = statSync(file)
    if (!stat.isFile()) return null
    return readFileSync(file, 'utf-8')
  }

  write(path: string, content: string): void {
    const file = this.resolve(path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content, 'utf-8')
  }

  append(path: string, content: string): void {
    const file = this.resolve(path)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, content, 'utf-8')
  }

  exists(path: string): boolean {
    return existsSync(this.resolve(path))
  }

  readAll(): Record<string, string> {
    const out: Record<string, string> = {}
    if (!existsSync(this.root)) return out
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          visit(full)
          continue
        }
        if (!entry.isFile()) continue
        const rel = relative(this.root, full)
        out[rel] = readFileSync(full, 'utf-8')
      }
    }
    visit(this.root)
    return out
  }

  list(path = ''): string[] {
    const dir = this.resolve(path)
    if (!existsSync(dir)) return []
    const stat = statSync(dir)
    if (!stat.isDirectory()) return []
    return readdirSync(dir).sort()
  }

  remove(path: string): void {
    const target = this.resolve(path)
    rmSync(target, { recursive: true, force: true })
  }

  rename(from: string, to: string): void {
    const src = this.resolve(from)
    const dest = this.resolve(to)
    mkdirSync(dirname(dest), { recursive: true })
    renameSync(src, dest)
  }

  stat(path: string) {
    const target = this.resolve(path)
    if (!existsSync(target)) return null
    const stat = statSync(target)
    return {
      path,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
    }
  }

  readJson<T = unknown>(path: string): T | null {
    const text = this.read(path)
    if (text === null) return null
    return JSON.parse(text) as T
  }

  writeJson(path: string, value: unknown): void {
    this.write(path, JSON.stringify(value, null, 2))
  }

  searchPath(path: string): string {
    if (isAbsolute(path)) {
      throw new Error(`Plugin storage path must be relative: ${path}`)
    }
    const normalized = normalize(path)
    if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
      throw new Error(`Plugin storage path must not escape plugin root: ${path}`)
    }
    return join('plugin-data', this.pluginId, normalized === '.' ? '' : normalized).replaceAll('\\', '/')
  }
}
