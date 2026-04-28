/**
 * Daily-note tier parser.
 *
 * One `workspace/memory/YYYY-MM-DD*.md` file → one `MemoryRow`. No chunking;
 * daily notes tend to be short-form activity summaries, and runtime memory
 * search usually treats them as whole documents.
 *
 * The filename must start with a `YYYY-MM-DD` prefix and end with `.md`.
 * Anything else returns null — the indexer skips null rows.
 */
import { createHash } from 'crypto'
import type { MemoryRow } from '../types'

const SNIPPET_CAP = 2048
const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})([-.].*)?\.md$/

export function parseDailyNote(
  agent: string,
  filename: string,
  body: string,
  sourcePath: string,
  mtimeMs: number,
  sizeBytes: number,
): MemoryRow | null {
  const match = DATE_PREFIX_RE.exec(filename)
  if (!match) return null
  const date = match[1]

  const snippet = body.length > SNIPPET_CAP ? body.slice(0, SNIPPET_CAP) : body
  const id = rowId(agent, filename)

  return {
    id,
    tier: 'daily_note',
    agent,
    title: filename,
    snippet,
    content: body,
    sourceRef: {
      backend: 'openclaw',
      path: sourcePath,
      file: filename,
    },
    updatedAt: mtimeMs,
    createdAt: mtimeMs,
    meta: JSON.stringify({
      file: filename,
      date,
      sizeBytes,
      openclawIndexed: true,
    }),
  }
}

export function rowId(agent: string, filename: string): string {
  const hash = createHash('sha256').update(`${agent}|${filename}`).digest('hex').slice(0, 16)
  return `daily_note:${hash}`
}
