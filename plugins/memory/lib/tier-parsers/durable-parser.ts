/**
 * Durable tier parser.
 *
 * A canonical bootstrap file (`SOUL.md`, `MEMORY.md`, etc.) is chunked on
 * H1 and H2 boundaries — one `MemoryRow` per chunk — so semantic search
 * can return the relevant heading instead of the whole file. H3+ headings
 * stay inside the enclosing H2 body. Files with no headings produce a
 * single row (chunkIndex=0, headingLevel=0, headingPath=[]).
 */
import { createHash } from 'crypto'
import type { MemoryRow } from '../types'

const SNIPPET_CAP = 2048

interface Chunk {
  title: string
  headingLevel: 0 | 1 | 2
  headingPath: string[]
  content: string
}

export function parseDurableFile(
  agent: string,
  basename: string,
  body: string,
  sourcePath: string,
  mtimeMs: number,
): MemoryRow[] {
  const chunks = chunkByHeading(body, basename)
  return chunks.map((chunk, chunkIndex) => {
    const content = chunk.content
    const snippet = content.length > SNIPPET_CAP ? content.slice(0, SNIPPET_CAP) : content
    const id = rowId(agent, basename, chunkIndex)
    return {
      id,
      tier: 'durable',
      agent,
      title: chunk.title,
      snippet,
      content,
      sourceRef: {
        backend: 'openclaw',
        path: sourcePath,
        file: basename,
      },
      updatedAt: mtimeMs,
      createdAt: mtimeMs,
      meta: JSON.stringify({
        file: basename,
        headingLevel: chunk.headingLevel,
        headingPath: chunk.headingPath,
        chunkIndex,
      }),
    }
  })
}

export function rowId(agent: string, basename: string, chunkIndex: number): string {
  const hash = createHash('sha256')
    .update(`${agent}|${basename}|${chunkIndex}`)
    .digest('hex')
    .slice(0, 16)
  return `durable:${hash}`
}

function chunkByHeading(body: string, basename: string): Chunk[] {
  const lines = body.split('\n')
  const chunks: Chunk[] = []

  let current: Chunk | null = null
  let currentH1: string | null = null

  for (const line of lines) {
    const match = /^(#{1,2})\s+(.+?)\s*$/.exec(line)
    if (match) {
      const level = match[1].length as 1 | 2
      const title = match[2]
      if (current) chunks.push(finalize(current))
      if (level === 1) currentH1 = title
      current = {
        title,
        headingLevel: level,
        headingPath: level === 1 ? [title] : [currentH1 ?? '', title].filter(Boolean) as string[],
        content: line,
      }
    } else if (current) {
      current.content += '\n' + line
    } else {
      // Pre-heading body → single no-heading chunk gets opened lazily.
      current = {
        title: basename,
        headingLevel: 0,
        headingPath: [],
        content: line,
      }
    }
  }

  if (current) {
    chunks.push(finalize(current))
  } else {
    // Empty file — emit one empty chunk so the file is still represented.
    chunks.push({ title: basename, headingLevel: 0, headingPath: [], content: '' })
  }

  return chunks
}

function finalize(chunk: Chunk): Chunk {
  return { ...chunk, content: chunk.content.replace(/\n+$/, '') }
}
