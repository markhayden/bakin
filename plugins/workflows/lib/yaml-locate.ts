/**
 * Where a Health finding points inside the raw text the recover editor
 * shows (self-healing PR1, Codex r1 #7): a dotted path such as
 * `steps.0.bogus` → the 1-based line of that key, or a skill section →
 * its line. Best effort on the text as written — a path that cannot be
 * followed yields null and the editor simply opens at the top.
 */

interface Node { line: number; indent: number; kind: 'root' | 'key' | 'item' }

const indentOf = (line: string): number => line.length - line.trimStart().length
const isNoise = (line: string): boolean => line.trim() === '' || line.trimStart().startsWith('#')
const KEY_RE = /^([^\s:#"'][^:]*?|"[^"]*"|'[^']*')\s*:(?:\s|$)/
const keyOf = (body: string): string | null => {
  const match = KEY_RE.exec(body)
  return match ? match[1]!.replace(/^["']|["']$/g, '') : null
}

export function locateYamlLine(text: string, path: string | null | undefined): number | null {
  if (!path) return null
  const lines = text.split('\n')
  const segments = path.split('.').filter((segment) => segment !== '')
  if (segments.length === 0) return null
  let node: Node = { line: -1, indent: -1, kind: 'root' }
  for (const segment of segments) {
    const index = /^\d+$/.test(segment) ? Number(segment) : null
    let next: Node | null = null
    let blockIndent = -1
    let count = -1
    // An item's first key may share its dash line (`- id: s1`): start on the dash line itself.
    const start = node.kind === 'item' ? node.line : node.line + 1
    for (let i = start; i < lines.length; i += 1) {
      const raw = lines[i]!
      if (isNoise(raw)) continue
      let indent = indentOf(raw)
      let body = raw.trimStart()
      const isItem = /^-(\s|$)/.test(body)
      const onDashLine = node.kind === 'item' && i === node.line
      if (index !== null) {
        // Sequence items under a key sit at the key's indent or deeper; another key at the key's level ends the block.
        if (!isItem) { if (indent <= node.indent) break; continue }
        if (indent < node.indent) break
        if (blockIndent === -1) blockIndent = indent
        if (indent !== blockIndent) continue // a nested list's item
        count += 1
        if (count === index) { next = { line: i, indent, kind: 'item' }; break }
        continue
      }
      if (onDashLine) {
        body = body.replace(/^-\s*/, '')
        indent = node.indent + 2
        if (body === '') continue
      } else {
        if (indent <= node.indent) break // left the parent's block
        if (isItem) continue // a list item inside this mapping is never the key itself
      }
      if (blockIndent === -1) blockIndent = indent
      if (indent !== blockIndent) continue
      if (keyOf(body) === segment) { next = { line: i, indent, kind: 'key' }; break }
    }
    if (!next) return null
    node = next
  }
  return node.line + 1
}

/** The line a skill finding points at: the top for a missing frontmatter block; `output_schema` (or where it belongs — the closing fence) otherwise. */
export function locateSkillSectionLine(content: string, section: 'frontmatter' | 'output_schema' | null | undefined): number | null {
  if (!section) return null
  if (section === 'frontmatter') return 1
  const lines = content.split('\n')
  const schema = lines.findIndex((line) => /^output_schema\s*:/.test(line))
  if (schema !== -1) return schema + 1
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (close !== -1) return close + 1
  }
  return 1
}
