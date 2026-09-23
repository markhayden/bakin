import type { Blockquote, Root, RootContent } from 'mdast'

const MARKER = /^<!--\s*bakin:([^\s]+?):(start|end)\s*-->\s*$/

function marker(node: RootContent) {
  return node.type === 'html' ? MARKER.exec(node.value) : null
}

/** Present managed sections after the whole document has been parsed. Fences,
 * references and list structure therefore retain ordinary Markdown semantics. */
export function remarkManagedSections() {
  return (tree: Root) => {
    const output: RootContent[] = []
    for (let index = 0; index < tree.children.length; index++) {
      const node = tree.children[index]!
      const start = marker(node)
      if (!start || start[2] !== 'start') {
        output.push(node)
        continue
      }
      let end = index + 1
      for (; end < tree.children.length; end++) {
        const candidate = marker(tree.children[end]!)
        if (candidate?.[1] === start[1] && candidate[2] === 'end') break
      }
      // Incomplete markers stay ordinary (non-rendered) HTML comments.
      if (end === tree.children.length) {
        output.push(node)
        continue
      }
      const section: Blockquote = {
        type: 'blockquote',
        data: {
          hName: 'section',
          hProperties: {
            'data-bakin-block': start[1],
            'aria-label': `Managed section: ${start[1]}`,
            className: 'my-bakin-4 rounded-bakin-surface border border-dashed border-bakin-border-subtle bg-bakin-surface-default/55 px-bakin-4 py-bakin-3',
          },
        },
        children: [
          {
            type: 'paragraph',
            data: { hProperties: { className: 'mb-bakin-2 font-bakin-typography-family-mono [font-size:var(--bakin-typography-size-meta)] uppercase tracking-widest text-bakin-text-muted' } },
            children: [{ type: 'text', value: `bakin:${start[1]}` }],
          },
          ...tree.children.slice(index + 1, end) as Blockquote['children'],
        ],
      }
      output.push(section)
      index = end
    }
    tree.children = output
  }
}
