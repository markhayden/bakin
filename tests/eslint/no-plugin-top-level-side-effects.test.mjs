import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import rule from '../../scripts/eslint-rules/no-plugin-top-level-side-effects.mjs'

function lint(code, filename = 'plugins/example/index.ts') {
  const linter = new Linter({ configType: 'flat' })
  return linter.verify(
    code,
    {
      files: ['**/*.{ts,tsx,js,mjs,mts}'],
      languageOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2024,
        sourceType: 'module',
        parserOptions: {
          ecmaFeatures: { jsx: true },
        },
      },
      plugins: {
        bakin: {
          rules: {
            'no-plugin-top-level-side-effects': rule,
          },
        },
      },
      rules: {
        'bakin/no-plugin-top-level-side-effects': 'error',
      },
    },
    { filename },
  )
}

function expectClean(code, filename) {
  expect(lint(code, filename)).toEqual([])
}

function expectOneError(code, expectedText) {
  const messages = lint(code)
  expect(messages).toHaveLength(1)
  expect(messages[0].ruleId).toBe('bakin/no-plugin-top-level-side-effects')
  expect(messages[0].message).toContain(expectedText)
}

describe('bakin/no-plugin-top-level-side-effects', () => {
  it('allows lifetime work inside plugin lifecycle hooks', () => {
    expectClean(`
      import type { BakinPlugin } from '@makinbakin/sdk/types'

      let timer
      const plugin: BakinPlugin = {
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        activate() {
          timer = setInterval(() => {}, 1000)
          process.on('SIGTERM', () => {})
        },
        onShutdown() {
          clearInterval(timer)
        },
      }

      export default plugin
    `)
  })

  it('allows component and route-local side effects', () => {
    expectClean(`
      import { useEffect } from 'react'

      export function Demo() {
        useEffect(() => {
          const timer = window.setInterval(() => {}, 1000)
          const es = new EventSource('/api/events')
          window.addEventListener('resize', () => {})
          return () => {
            clearInterval(timer)
            es.close()
          }
        }, [])
        return null
      }

      export const route = {
        handler() {
          const ws = new WebSocket('ws://localhost')
          return new Response('ok')
        },
      }
    `, 'plugins/example/client.tsx')
  })

  it('allows top-level zero-delay timeout scheduling', () => {
    expectClean(`
      setTimeout(() => {})
      window.setTimeout(() => {}, 0)
    `)
  })

  it('flags top-level timers', () => {
    expectOneError(`
      setInterval(() => {}, 1000)
    `, 'timer')
  })

  it('flags top-level dynamic-delay timeouts', () => {
    expectOneError(`
      const delay = Number(process.env.DELAY_MS ?? 1000)
      globalThis.setTimeout(() => {}, delay)
    `, 'timer')
  })

  it('flags timers inside top-level IIFEs', () => {
    expectOneError(`
      ;(async () => {
        setInterval(() => {}, 1000)
      })()
    `, 'timer')
  })

  it('flags process listeners', () => {
    expectOneError(`
      process.addListener('SIGINT', () => {})
    `, 'process listener')
  })

  it('flags fs watchers from namespace and named imports', () => {
    const messages = lint(`
      import fs from 'node:fs'
      import { watch as watchFile } from 'fs'

      fs.watch('/tmp', () => {})
      watchFile('/tmp', () => {})
    `)

    expect(messages).toHaveLength(2)
    expect(messages.every((message) => message.message.includes('file watcher'))).toBe(true)
  })

  it('flags chokidar watchers', () => {
    expectOneError(`
      import * as chokidar from 'chokidar'

      chokidar.watch('.')
    `, 'file watcher')
  })

  it('flags top-level connections', () => {
    const messages = lint(`
      new WebSocket('ws://localhost')
      new window.EventSource('/api/events')
    `)

    expect(messages).toHaveLength(2)
    expect(messages.every((message) => message.message.includes('connection'))).toBe(true)
  })

  it('flags event-target listeners', () => {
    expectOneError(`
      document.addEventListener('visibilitychange', () => {})
    `, 'event listener')
  })

  it('flags direct EventEmitter listener chains', () => {
    const messages = lint(`
      import { EventEmitter } from 'node:events'

      new EventEmitter().on('change', () => {})
      const emitter = new EventEmitter()
      emitter.addListener('change', () => {})
    `)

    expect(messages).toHaveLength(2)
    expect(messages.every((message) => message.message.includes('event listener'))).toBe(true)
  })
})
