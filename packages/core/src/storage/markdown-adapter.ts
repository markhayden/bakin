/**
 * StorageAdapter implementation backed by the local filesystem.
 * Wraps the same fs logic that content.ts uses.
 */
import fs from 'fs'
import path from 'path'
import type { StorageAdapter } from '../plugin-types'
import { getContentDir } from '../content-dir'
import { walkFiles } from './walk'

export class MarkdownStorageAdapter implements StorageAdapter {
  private contentDir: string

  constructor(contentDir?: string) {
    this.contentDir = contentDir || getContentDir()
  }

  private resolve(relativePath: string): string {
    return path.join(this.contentDir, relativePath)
  }

  read(relativePath: string): string | null {
    try {
      return fs.readFileSync(this.resolve(relativePath), 'utf-8')
    } catch {
      return null
    }
  }

  write(relativePath: string, content: string): void {
    const full = this.resolve(relativePath)
    const dir = path.dirname(full)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(full, content, 'utf-8')
  }

  append(relativePath: string, content: string): void {
    const full = this.resolve(relativePath)
    const dir = path.dirname(full)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(full, content, 'utf-8')
  }

  exists(relativePath: string): boolean {
    return fs.existsSync(this.resolve(relativePath))
  }

  list(relativePath = ''): string[] {
    const full = this.resolve(relativePath)
    if (!fs.existsSync(full)) return []
    const stat = fs.statSync(full)
    if (!stat.isDirectory()) return []
    return fs.readdirSync(full).sort()
  }

  remove(relativePath: string): void {
    fs.rmSync(this.resolve(relativePath), { recursive: true, force: true })
  }

  rename(from: string, to: string): void {
    const src = this.resolve(from)
    const dest = this.resolve(to)
    const dir = path.dirname(dest)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.renameSync(src, dest)
  }

  stat(relativePath: string) {
    const full = this.resolve(relativePath)
    if (!fs.existsSync(full)) return null
    const stat = fs.statSync(full)
    return {
      path: relativePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
    }
  }

  readJson<T = unknown>(relativePath: string): T | null {
    const text = this.read(relativePath)
    if (text === null) return null
    return JSON.parse(text) as T
  }

  writeJson(relativePath: string, value: unknown): void {
    this.write(relativePath, JSON.stringify(value, null, 2))
  }

  readAll(): Record<string, string> {
    const result: Record<string, string> = {}
    const files = walkFiles(this.contentDir, {
      skipDotEntries: true,
      ext: ['.md', '.json', '.jsonl'],
    })
    for (const file of files) {
      try {
        result[file.relPath] = fs.readFileSync(file.path, 'utf-8')
      } catch {
        // skip unreadable files
      }
    }
    return result
  }

  searchPath(relativePath: string): string {
    return relativePath.replaceAll('\\', '/')
  }
}
