/**
 * POST /api/memory/log — append a decision / learned / note entry to
 * MEMORY-LOG.md.
 *
 * Migrated from src/app/api/memory/log/route.ts for Phase B of #147.
 */
import { readContentFile, writeContentFile } from '@/lib/content-files'
import { appendAudit } from '@/lib/audit'

const VALID_TYPES = ['decision', 'learned', 'note'] as const
type EntryType = (typeof VALID_TYPES)[number]

function formatEntry(type: EntryType, text: string): string {
  switch (type) {
    case 'decision':
      return `- **Decision:** ${text}`
    case 'learned':
      return `- **Learned:** ${text}`
    case 'note':
      return `- ${text}`
  }
}

function appendToMemoryLog(
  content: string,
  today: string,
  formattedEntry: string,
): string {
  const lines = content.split('\n')
  const todayHeader = `## ${today}`

  // Find if today's section exists
  const headerIdx = lines.findIndex((l) => l.trim() === todayHeader)

  if (headerIdx !== -1) {
    // Find the end of today's section (next ## or end of file)
    let insertIdx = headerIdx + 1
    while (insertIdx < lines.length && !lines[insertIdx].startsWith('## ')) {
      insertIdx++
    }
    // Back up past trailing blank lines to insert right after last entry
    while (insertIdx > headerIdx + 1 && lines[insertIdx - 1].trim() === '') {
      insertIdx--
    }
    lines.splice(insertIdx, 0, formattedEntry)
  } else {
    // Create today's section after the frontmatter (first blank line after header)
    // The file starts with "# Memory Log" and a description line
    let insertIdx = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        insertIdx = i
        break
      }
      if (i === lines.length - 1) {
        insertIdx = lines.length
      }
    }
    const newSection = [`${todayHeader}`, formattedEntry, '']
    lines.splice(insertIdx, 0, ...newSection)
  }

  return lines.join('\n')
}

export async function post(request: Request, _url: URL): Promise<Response> {
  try {
    const body = await request.json()
    const { type, agent, text } = body

    if (!type || !VALID_TYPES.includes(type)) {
      return Response.json(
        { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 })
    }
    if (!agent || typeof agent !== 'string') {
      return Response.json(
        { error: 'agent is required' },
        { status: 400 },
      )
    }

    const today = new Date().toISOString().slice(0, 10)
    const content = readContentFile('MEMORY-LOG.md') || '# Memory Log\n_Significant decisions and learnings — newest first_\n\n'
    const formatted = formatEntry(type as EntryType, text.trim())
    const updated = appendToMemoryLog(content, today, formatted)

    writeContentFile('MEMORY-LOG.md', updated)
    appendAudit('memory.logged', agent, { type, text: text.trim() })

    return Response.json({
      ok: true,
      entry: { type, agent, text: text.trim(), date: today },
    })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
