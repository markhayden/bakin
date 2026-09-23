import type { BlockContent, Nodes, Root, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const parser = unified().use(remarkParse).use(remarkGfm)
const MAX_STEPS = 1_000_000

export function parseMarkdown(source: string): Root {
  return parser.parse(source)
}

function visibleBlocks(tree: Root): RootContent[] {
  return tree.children.filter(node => !['definition', 'footnoteDefinition', 'html'].includes(node.type))
}

function fingerprints(tree: Root): string[] {
  const definitions = new Map<string, Nodes>()
  function collect(node: Nodes) {
    if (node.type === 'definition' || node.type === 'footnoteDefinition') {
      const key = `${node.type}:${node.identifier.toUpperCase()}`
      if (!definitions.has(key)) definitions.set(key, node)
    }
    if ('children' in node) node.children.forEach(collect)
  }
  collect(tree)
  function encode(node: Nodes, resolving = new Set<string>()): unknown {
    const { position: _position, data: _data, ...properties } = node
    const result: Record<string, unknown> = { ...properties }
    if ('children' in node) result.children = node.children.map(child => encode(child, resolving))
    if (node.type === 'linkReference' || node.type === 'imageReference' || node.type === 'footnoteReference') {
      const kind = node.type === 'footnoteReference' ? 'footnoteDefinition' : 'definition'
      const key = `${kind}:${node.identifier.toUpperCase()}`
      const definition = definitions.get(key)
      if (definition && !resolving.has(key)) result.definition = encode(definition, new Set([...resolving, key]))
    }
    return result
  }
  return visibleBlocks(tree).map(node => JSON.stringify(encode(node)))
}

export interface BlockComparison {
  available: boolean
  changed: Set<number>
  removedBefore: Map<number, number>
  steps: number
}

/** A bounded LCS over semantic blocks. Prefix/suffix trimming keeps large,
 * mostly unchanged documents cheap. No partial result is advertised as exact. */
export function compareMarkdownBlocks(previous: Root, current: Root): BlockComparison {
  const before = fingerprints(previous)
  const after = fingerprints(current)
  const changed = new Set<number>()
  const removedBefore = new Map<number, number>()
  let steps = 0
  const unavailable = (): BlockComparison => ({ available: false, changed: new Set(), removedBefore: new Map(), steps })
  let start = 0
  while (start < before.length && start < after.length) {
    if (steps === MAX_STEPS) return unavailable()
    steps++
    if (before[start] !== after[start]) break
    start++
  }
  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > start && afterEnd > start) {
    if (steps === MAX_STEPS) return unavailable()
    steps++
    if (before[beforeEnd - 1] !== after[afterEnd - 1]) break
    beforeEnd--
    afterEnd--
  }
  const rows = beforeEnd - start
  const columns = afterEnd - start
  // Count traversal as well as matrix work before allocating anything.
  if (steps + rows * columns + rows + columns > MAX_STEPS) return unavailable()
  const stride = columns + 1
  const matrix = new Uint32Array((rows + 1) * stride)
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      steps++
      matrix[row * stride + column] = before[start + row] === after[start + column]
        ? 1 + matrix[(row + 1) * stride + column + 1]!
        : Math.max(matrix[(row + 1) * stride + column]!, matrix[row * stride + column + 1]!)
    }
  }
  let row = 0
  let column = 0
  let removedInRun = 0
  let addedInRun = 0
  function finishRun() {
    // Paired old/new blocks are replacements; only surplus removals need a
    // separate marker. Place it after the replacement run, before the next anchor.
    if (removedInRun > addedInRun) removedBefore.set(start + column, removedInRun - addedInRun)
    removedInRun = 0
    addedInRun = 0
  }
  while (row < rows || column < columns) {
    steps++
    if (row < rows && column < columns && before[start + row] === after[start + column]) {
      finishRun()
      row++
      column++
    } else if (row < rows && (column === columns || matrix[(row + 1) * stride + column]! >= matrix[row * stride + column + 1]!)) {
      removedInRun++
      row++
    } else {
      changed.add(start + column)
      addedInRun++
      column++
    }
  }
  finishRun()
  return { available: true, changed, removedBefore, steps }
}

export function remarkComparison(previousSource: string | undefined) {
  return (tree: Root) => {
    if (previousSource === undefined) return
    const comparison = compareMarkdownBlocks(parseMarkdown(previousSource), tree)
    if (!comparison.available) {
      tree.children.unshift({
        type: 'paragraph',
        data: { hProperties: { role: 'status', 'data-md-comparison-unavailable': '', className: 'my-bakin-3 text-bakin-text-muted' } },
        children: [{ type: 'text', value: 'Comparison unavailable: this document exceeds the comparison limit. The complete current document is shown.' }],
      })
      return
    }
    const visible = new Set(visibleBlocks(tree))
    const output: RootContent[] = []
    let index = 0
    function removed() {
      const count = comparison.removedBefore.get(index)
      if (!count) return
      output.push({
        type: 'paragraph',
        data: { hProperties: { 'data-md-removed-blocks': count, className: 'my-bakin-3 border-l-2 border-bakin-border-subtle pl-bakin-3 text-bakin-text-muted' } },
        children: [{ type: 'text', value: `${count} ${count === 1 ? 'block' : 'blocks'} removed from the previous version.` }],
      })
    }
    for (const node of tree.children) {
      if (!visible.has(node)) {
        output.push(node)
        continue
      }
      removed()
      if (comparison.changed.has(index)) {
        output.push({
          type: 'blockquote',
          data: { hName: 'div', hProperties: { 'data-md-changed-block': '', className: 'my-bakin-3 min-w-0 border-l-2 border-bakin-action-primary-background pl-bakin-3' } },
          children: [
            { type: 'paragraph', data: { hProperties: { className: 'sr-only', 'data-md-change-hint': '' } }, children: [{ type: 'text', value: 'Changed block' }] },
            node as BlockContent,
          ],
        })
      } else output.push(node)
      index++
    }
    removed()
    tree.children = output
  }
}
