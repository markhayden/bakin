import fs from 'fs'
import path from 'path'

const CONTENT_DIR = path.join(process.cwd(), 'content')

export function readAllContent(): Record<string, string> {
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

  walk(CONTENT_DIR)
  return result
}

export function readContentFile(relativePath: string): string | null {
  const full = path.join(CONTENT_DIR, relativePath)
  try {
    return fs.readFileSync(full, 'utf-8')
  } catch {
    return null
  }
}

export function writeContentFile(relativePath: string, content: string): void {
  const full = path.join(CONTENT_DIR, relativePath)
  const dir = path.dirname(full)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
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
