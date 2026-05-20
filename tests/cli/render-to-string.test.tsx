import { describe, expect, it } from 'bun:test'
import { Text } from 'ink'

import {
  DEFAULT_TUI_COLUMNS,
  renderTuiToString,
  resolveTuiColumns,
} from '../../src/core/cli/ui/render-to-string'

type StdoutWithColumns = typeof process.stdout & { columns?: number }

function withStdoutColumns(columns: number | undefined, fn: () => void): void {
  const stdout = process.stdout as StdoutWithColumns
  const original = Object.getOwnPropertyDescriptor(stdout, 'columns')
  Object.defineProperty(stdout, 'columns', {
    configurable: true,
    value: columns,
  })

  try {
    fn()
  } finally {
    if (original) {
      Object.defineProperty(stdout, 'columns', original)
    } else {
      Reflect.deleteProperty(stdout, 'columns')
    }
  }
}

describe('shared TUI render-to-string', () => {
  it('uses a wider fallback than Ink default when stdout has no width', () => {
    withStdoutColumns(undefined, () => {
      const text = 'x'.repeat(100)

      expect(resolveTuiColumns()).toBe(DEFAULT_TUI_COLUMNS)
      expect(renderTuiToString(<Text>{text}</Text>)).toBe(text)
    })
  })

  it('uses the current stdout width when available', () => {
    withStdoutColumns(40, () => {
      const text = 'x'.repeat(50)

      expect(resolveTuiColumns()).toBe(40)
      expect(renderTuiToString(<Text>{text}</Text>).split('\n').every(line => line.length <= 40)).toBe(true)
    })
  })
})
