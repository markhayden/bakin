/**
 * Markdown frontmatter parsing — the one place that owns the `---\n…\n---`
 * split and the two ways Bakin reads it: full YAML (skill files) and a tiny
 * line parser (lesson files). Previously the split regex was copy-pasted into
 * ~10 files, `parseSkillFile` verbatim into 3, and the lesson line parser into 4.
 */
import yaml from 'js-yaml'

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

export interface SplitFrontmatter {
  /** Raw frontmatter block (between the `---` fences), or null when absent. */
  raw: string | null
  /** Document body after the frontmatter, trimmed. */
  body: string
}

/** Split a document into its raw frontmatter block + body (no parsing). */
export function splitFrontmatter(content: string): SplitFrontmatter {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return { raw: null, body: content.trim() }
  return { raw: match[1], body: match[2].trim() }
}

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>
  body: string
}

/**
 * Parse YAML frontmatter. On a missing fence or a YAML error, returns empty
 * frontmatter with the whole (trimmed) content as the body — the lenient
 * behaviour every skill loader relied on.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const { raw, body } = splitFrontmatter(content)
  if (raw === null) return { frontmatter: {}, body }
  try {
    return { frontmatter: (yaml.load(raw) as Record<string, unknown>) || {}, body }
  } catch {
    return { frontmatter: {}, body: content.trim() }
  }
}

export interface LessonFrontmatter {
  /** `title:` value, if present (surrounding quotes stripped). Caller supplies the fallback. */
  title?: string
  /** `defaultEnabled: true` → true; anything else → false. */
  defaultEnabled: boolean
  /** `tags: [a, b]` inline list (quotes stripped, empties dropped). */
  tags: string[]
  body: string
}

/**
 * Parse the line-based lesson frontmatter (`title:` / `defaultEnabled:` /
 * `tags:`) used by the agent-package lesson files. Intentionally NOT full YAML —
 * it tolerates the loose hand-authored shape lessons ship with. Callers read
 * whichever fields they need and apply their own title fallback.
 */
export function parseLessonFrontmatter(content: string): LessonFrontmatter {
  const { raw, body } = splitFrontmatter(content)
  const result: LessonFrontmatter = { defaultEnabled: false, tags: [], body }
  if (raw === null) return result
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('title:')) {
      result.title = trimmed.slice('title:'.length).trim().replace(/^['"]|['"]$/g, '')
    } else if (trimmed.startsWith('defaultEnabled:')) {
      result.defaultEnabled = trimmed.slice('defaultEnabled:'.length).trim() === 'true'
    } else if (trimmed.startsWith('tags:')) {
      const rest = trimmed.slice('tags:'.length).trim()
      if (rest.startsWith('[') && rest.endsWith(']')) {
        result.tags = rest.slice(1, -1).split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter((t) => t.length > 0)
      }
    }
  }
  return result
}
