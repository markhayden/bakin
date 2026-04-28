/**
 * Skill-file parser.
 *
 * Agent skills live at `{workspace}/skills/<name>/SKILL.md`. Treated as a
 * sub-flavor of the durable tier (tier=`durable`, kind=`skill`) so they sit
 * alongside SOUL/TOOLS/AGENTS in search and the /memory UI filters them via
 * the Kind facet instead of inventing a new tier.
 *
 * Chunking reuses the durable parser's H1/H2 rule so headings-as-chunk-title
 * stays consistent across durable-family files.
 */
import { createHash } from 'crypto'
import { chunkByHeadingExported } from './durable-parser'
import type { MemoryRow } from '../types'

const SNIPPET_CAP = 2048

export function parseSkillFile(
  agent: string,
  skillName: string,
  body: string,
  sourcePath: string,
  mtimeMs: number,
): MemoryRow[] {
  const chunks = chunkByHeadingExported(body, skillName)
  return chunks.map((chunk, chunkIndex) => {
    const content = chunk.content
    const snippet = content.length > SNIPPET_CAP ? content.slice(0, SNIPPET_CAP) : content
    const id = rowId(agent, skillName, chunkIndex)
    // Compose a title that shows both the skill name and the chunk heading
    // so search results read as "<skill> — <heading>" rather than just the
    // heading (which can be generic like "Usage").
    const title = chunk.headingLevel === 0 || chunk.title === skillName
      ? skillName
      : `${skillName} — ${chunk.title}`
    return {
      id,
      tier: 'durable',
      agent,
      kind: 'skill',
      title,
      snippet,
      content,
      sourceRef: {
        backend: 'runtime',
        path: sourcePath,
        file: 'SKILL.md',
      },
      updatedAt: mtimeMs,
      createdAt: mtimeMs,
      meta: JSON.stringify({
        file: 'SKILL.md',
        skillName,
        headingLevel: chunk.headingLevel,
        headingPath: chunk.headingPath,
        chunkIndex,
      }),
    }
  })
}

export function rowId(agent: string, skillName: string, chunkIndex: number): string {
  const hash = createHash('sha256')
    .update(`${agent}|skill|${skillName}|${chunkIndex}`)
    .digest('hex')
    .slice(0, 16)
  return `skill:${hash}`
}
