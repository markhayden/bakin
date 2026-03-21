/**
 * Content file helpers — backward-compatible bridge.
 * Internally delegates to MarkdownStorageAdapter.
 */
import fs from 'fs'
import path from 'path'
import { MarkdownStorageAdapter } from './storage/markdown-adapter'

const CONTENT_DIR = path.join(process.cwd(), 'content')
const adapter = new MarkdownStorageAdapter(CONTENT_DIR)

export function readAllContent(): Record<string, string> {
  return adapter.readAll()
}

export function readContentFile(relativePath: string): string | null {
  return adapter.read(relativePath)
}

export function writeContentFile(relativePath: string, content: string): void {
  adapter.write(relativePath, content)
}

export function readHeartbeats(): Record<string, unknown> {
  const dir = path.join(CONTENT_DIR, 'heartbeats')
  const result: Record<string, unknown> = {}
  if (!fs.existsSync(dir)) return result
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
      result[f.replace('.json', '')] = data
    } catch {
      // skip
    }
  }
  return result
}
