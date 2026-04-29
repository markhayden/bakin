/**
 * Dream tier parser.
 *
 * Five artifact types land here, each producing at most one MemoryRow:
 *
 *   phase_doc          — workspace/memory/dreaming/<phase>/<YYYY-MM-DD>.md
 *   short_term_recall  — workspace/memory/.dreams/short-term-recall.json
 *   phase_signals      — workspace/memory/.dreams/phase-signals.json
 *   events_log         — workspace/memory/.dreams/events.jsonl
 *   session_corpus     — workspace/memory/.dreams/session-corpus/<YYYY-MM-DD>.{md,txt}
 *
 * Dreaming starts dormant on a fresh runtime install — `short-term-recall.json`
 * and `events.jsonl` exist but are empty. The parser still emits rows for those
 * (empty content) so the UI can surface "dormant" copy rather than a mysterious
 * absence. Unknown filenames under `.dreams/` return null.
 */
import { createHash } from 'crypto'
import type { MemoryRow, DreamArtifactType } from '../types'

const SNIPPET_CAP = 2048
const DATE_RE = /(\d{4}-\d{2}-\d{2})/
const PHASE_DOC_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})(?:[-.].*)?\.md$/
const SESSION_CORPUS_RE = /^session-corpus\/(\d{4}-\d{2}-\d{2})(?:[-.].*)?\.(md|txt)$/

export function classifyDreamSignal(
  relPath: string,
): { artifactType: DreamArtifactType; date: string | null } | null {
  if (relPath === 'short-term-recall.json') {
    return { artifactType: 'short_term_recall', date: null }
  }
  if (relPath === 'phase-signals.json') {
    return { artifactType: 'phase_signals', date: null }
  }
  if (relPath === 'events.jsonl') {
    return { artifactType: 'events_log', date: null }
  }
  const m = SESSION_CORPUS_RE.exec(relPath)
  if (m) {
    return { artifactType: 'session_corpus', date: m[1] }
  }
  return null
}

export function parsePhaseDoc(
  agent: string,
  phase: string,
  filename: string,
  body: string,
  sourcePath: string,
  mtimeMs: number,
): MemoryRow | null {
  const m = PHASE_DOC_FILENAME_RE.exec(filename)
  if (!m) return null
  const date = m[1]
  const snippet = body.length > SNIPPET_CAP ? body.slice(0, SNIPPET_CAP) : body
  return {
    id: rowId(agent, 'phase_doc', `${phase}|${date}`),
    tier: 'dream',
    agent,
    title: `Dream · ${phase} · ${date}`,
    snippet,
    content: body,
    sourceRef: {
      backend: 'runtime',
      path: sourcePath,
      file: filename,
    },
    updatedAt: mtimeMs,
    createdAt: parseDateAsMs(date) ?? mtimeMs,
    meta: JSON.stringify({
      phase,
      date,
      sourceDay: date,
      artifactType: 'phase_doc',
    }),
  }
}

export function parseDreamSignal(
  agent: string,
  relPath: string,
  body: string,
  sourcePath: string,
  mtimeMs: number,
): MemoryRow | null {
  const c = classifyDreamSignal(relPath)
  if (!c) return null

  const snippet = body.length > SNIPPET_CAP ? body.slice(0, SNIPPET_CAP) : body
  const key = c.date ?? c.artifactType
  const title = signalTitle(c.artifactType, c.date)

  return {
    id: rowId(agent, c.artifactType, key),
    tier: 'dream',
    agent,
    title,
    snippet,
    content: body,
    sourceRef: {
      backend: 'runtime',
      path: sourcePath,
      file: basename(relPath),
    },
    updatedAt: mtimeMs,
    createdAt: (c.date ? parseDateAsMs(c.date) : null) ?? mtimeMs,
    meta: JSON.stringify({
      phase: null,
      date: c.date,
      sourceDay: c.date,
      artifactType: c.artifactType,
    }),
  }
}

function signalTitle(type: DreamArtifactType, date: string | null): string {
  switch (type) {
    case 'short_term_recall': return 'Dream · short-term recall'
    case 'phase_signals': return 'Dream · phase signals'
    case 'events_log': return 'Dream · events log'
    case 'session_corpus': return date ? `Dream · session corpus · ${date}` : 'Dream · session corpus'
    case 'phase_doc': return 'Dream · phase doc'
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

function parseDateAsMs(date: string): number | null {
  const m = DATE_RE.exec(date)
  if (!m) return null
  const t = Date.parse(`${m[1]}T00:00:00Z`)
  return Number.isFinite(t) ? t : null
}

export function rowId(agent: string, artifactType: DreamArtifactType, key: string): string {
  const hash = createHash('sha256').update(`${agent}|${artifactType}|${key}`).digest('hex').slice(0, 16)
  return `dream:${hash}`
}
