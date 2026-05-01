/**
 * Managed-block primitives for markdown files.
 *
 * Bakin owns specific regions of agent-owned markdown files (SOUL.md, AGENTS.md,
 * etc.) via marker pairs:
 *
 *   <!-- bakin:<blockId>:start -->
 *   ...managed content...
 *   <!-- bakin:<blockId>:end -->
 *
 * Outside the markers the file belongs to the agent (or user). Inside, Bakin
 * is authoritative: the installer/projector/doctor write and update content,
 * and the user is told not to edit by hand.
 *
 * Marker namespace conventions (used by callers, enforced by callers):
 *   - bakin:knowledge-catalog                    → table of contents in SOUL.md
 *   - bakin:knowledge:<package>:<lesson-id>      → one block per enabled lesson
 *   - bakin:managed-context                      → compact AGENTS.md context
 *   - bakin:mission-control, etc.                → legacy AGENTS.md rule blocks,
 *                                                   converted by doctor when
 *                                                   well-formed
 *
 * This module is pure: it operates on string content, never touches the
 * filesystem. Callers decide which marker namespaces they own.
 */

const START_MARKER_PATTERN = /^<!-- bakin:([\w:.-]+):start -->$/
const END_MARKER_PATTERN = /^<!-- bakin:([\w:.-]+):end -->$/

function startMarker(blockId: string): string {
  return `<!-- bakin:${blockId}:start -->`
}

function endMarker(blockId: string): string {
  return `<!-- bakin:${blockId}:end -->`
}

/**
 * Block ids must be non-empty strings of word chars, hyphens, dots, or colons.
 * Colons are used as separators (e.g. `knowledge:pixel:product-photography`).
 */
export function isValidBlockId(blockId: string): boolean {
  return /^[\w.-][\w:.-]*$/.test(blockId)
}

/**
 * Detailed state of a managed block in some content. Used by callers (e.g.
 * `bakin doctor`) that need to distinguish between "block was never written"
 * and "block markers are malformed" — the second case is unsafe to silently
 * repair because we don't know what the user's intent was.
 *
 *   - 'absent'        — neither start nor end marker present
 *   - 'present'       — both markers present and properly paired
 *   - 'orphan-start'  — start marker present but no matching end marker
 *   - 'orphan-end'    — end marker present but no matching start marker
 */
export type BlockState = 'absent' | 'present' | 'orphan-start' | 'orphan-end'

export function getBlockState(content: string, blockId: string): BlockState {
  if (!isValidBlockId(blockId)) return 'absent'
  const hasStart = content.includes(startMarker(blockId))
  const hasEnd = content.includes(endMarker(blockId))
  if (hasStart && hasEnd) {
    // Order matters — start must come before end for the pair to be valid.
    if (content.indexOf(startMarker(blockId)) < content.indexOf(endMarker(blockId))) {
      return 'present'
    }
    // Out-of-order markers — treat as orphan-end (start before end is the
    // canonical shape; reverse means the end isn't actually closing anything).
    return 'orphan-end'
  }
  if (hasStart) return 'orphan-start'
  if (hasEnd) return 'orphan-end'
  return 'absent'
}

/**
 * True iff the content has a properly-paired marker pair for the block id.
 * Falses on missing pair, on start without end, on end without start.
 */
export function hasBlock(content: string, blockId: string): boolean {
  return extractBlock(content, blockId) !== null
}

/**
 * Extract the body of a managed block. Returns the body trimmed of leading/
 * trailing whitespace. Returns null when:
 *   - no start marker
 *   - start marker without an end marker
 *   - markers paired but reversed (end before start)
 *
 * Nested markers are treated as content — the *first* matching end marker for
 * a given block id closes the block.
 */
export function extractBlock(content: string, blockId: string): string | null {
  if (!isValidBlockId(blockId)) return null
  const start = content.indexOf(startMarker(blockId))
  if (start === -1) return null
  const end = content.indexOf(endMarker(blockId), start + startMarker(blockId).length)
  if (end === -1) return null
  return content.slice(start + startMarker(blockId).length, end).trim()
}

/**
 * List every block in the content. Mismatched markers (start-without-end or
 * end-without-start) are skipped silently — callers can independently call
 * `hasBlock` for the specific ids they care about. Order matches first-marker
 * appearance in the file.
 */
export function listBlocks(content: string): { blockId: string; body: string }[] {
  const lines = content.split('\n')
  const out: { blockId: string; body: string }[] = []
  const stack: { blockId: string; lineIdx: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    const startMatch = lines[i].match(START_MARKER_PATTERN)
    if (startMatch) {
      stack.push({ blockId: startMatch[1], lineIdx: i })
      continue
    }
    const endMatch = lines[i].match(END_MARKER_PATTERN)
    if (!endMatch) continue
    // Pop the matching start (last-in-first-out for nested) — even though we
    // don't strictly nest, this protects against malformed files.
    for (let j = stack.length - 1; j >= 0; j--) {
      if (stack[j].blockId === endMatch[1]) {
        const body = lines
          .slice(stack[j].lineIdx + 1, i)
          .join('\n')
          .trim()
        out.push({ blockId: stack[j].blockId, body })
        stack.splice(j, 1)
        break
      }
    }
  }

  return out
}

/**
 * Insert or update a managed block.
 *
 * If the block already exists, its body is replaced; surrounding content is
 * preserved exactly. If absent, the block is appended at the end of the file
 * with a single blank line separating it from prior content.
 *
 * Throws if `blockId` is malformed.
 */
export function injectBlock(
  content: string,
  blockId: string,
  body: string,
): string {
  if (!isValidBlockId(blockId)) {
    throw new Error(`Invalid blockId: "${blockId}"`)
  }
  const start = startMarker(blockId)
  const end = endMarker(blockId)
  const startIdx = content.indexOf(start)
  const trimmedBody = body.trim()

  if (startIdx === -1) {
    // Append. Ensure exactly one blank line of separation.
    const block = `${start}\n${trimmedBody}\n${end}\n`
    if (content.length === 0) return block
    const trimmed = content.replace(/\s+$/, '')
    return `${trimmed}\n\n${block}`
  }

  const endIdx = content.indexOf(end, startIdx + start.length)
  if (endIdx === -1) {
    // Start without end — treat as malformed but recoverable: replace from
    // start marker to end-of-file with a fresh block.
    const fresh = `${start}\n${trimmedBody}\n${end}\n`
    return content.slice(0, startIdx) + fresh
  }

  // Replace body, preserving everything outside the markers.
  const before = content.slice(0, startIdx)
  const after = content.slice(endIdx + end.length)
  return `${before}${start}\n${trimmedBody}\n${end}${after}`
}

/**
 * Remove a managed block (markers + body) from the content. If the block isn't
 * present, returns the input unchanged. Surrounding whitespace is normalized
 * so removals don't leave double-blank-line gashes.
 */
export function removeBlock(content: string, blockId: string): string {
  if (!isValidBlockId(blockId)) return content
  const start = startMarker(blockId)
  const end = endMarker(blockId)
  const startIdx = content.indexOf(start)
  if (startIdx === -1) return content
  const endIdx = content.indexOf(end, startIdx + start.length)
  if (endIdx === -1) {
    // Start-without-end — remove from start to EOF.
    return content.slice(0, startIdx).replace(/\s+$/, '') + '\n'
  }
  const before = content.slice(0, startIdx).replace(/\s+$/, '')
  const after = content.slice(endIdx + end.length).replace(/^\s+/, '')
  if (before.length === 0 && after.length === 0) return ''
  if (before.length === 0) return after
  if (after.length === 0) return before + '\n'
  return `${before}\n\n${after}`
}
