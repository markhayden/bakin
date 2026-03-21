/**
 * StorageAdapter implementation backed by the local filesystem.
 * Wraps the same fs logic that content.ts uses.
 */
import fs from 'fs'
import path from 'path'
import type { StorageAdapter } from '../plugin-types'

export class MarkdownStorageAdapter implements StorageAdapter {
  private contentDir: string

  constructor(contentDir?: string) {
    this.contentDir = contentDir || path.join(process.cwd(), 'content')
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

  readAll(): Record<string, string> {
    const result: Record<string, string> = {}

    function walk(dir: string, prefix: string = '') {
      if (!fs.existsSync(dir)) return
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full, rel)
        } else if (/\.(md|json|jsonl)$/.test(entry.name)) {
          try {
            result[rel] = fs.readFileSync(full, 'utf-8')
          } catch {
            // skip unreadable files
          }
        }
      }
    }

    walk(this.contentDir)
    return result
  }
}
