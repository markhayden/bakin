import { listDefinitions } from './parser'

/**
 * Auto-match a task to a workflow based on title (and optional description).
 *
 * Tokenizes each workflow ID (split on `-`) and checks whether ALL tokens
 * appear in the lowercased input text. If multiple workflows match, the
 * most specific one (most tokens) wins.
 *
 * Returns the workflow id or null if nothing matches.
 */
export function matchWorkflow(title: string, description?: string): string | null {
  const text = `${title} ${description || ''}`.toLowerCase()
  const defs = listDefinitions()

  let bestMatch: string | null = null
  let bestScore = 0

  for (const { name } of defs) {
    const tokens = name.split('-')
    const allMatch = tokens.every(token => text.includes(token))
    if (allMatch && tokens.length > bestScore) {
      bestScore = tokens.length
      bestMatch = name
    }
  }

  return bestMatch
}
