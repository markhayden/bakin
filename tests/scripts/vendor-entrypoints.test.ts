import { describe, expect, it } from 'bun:test'

import { jsxDevRuntimeEntrySource } from '../../scripts/vendor-entrypoints'

describe('vendor entrypoints', () => {
  it('generates a production jsxDEV shim for stale installed plugin clients', () => {
    const source = jsxDevRuntimeEntrySource({
      production: true,
      jsxRuntimeAbs: '/abs/react/jsx-runtime.js',
      jsxDevRuntimeAbs: '/abs/react/jsx-dev-runtime.js',
    })

    expect(source).toContain('export function jsxDEV')
    expect(source).toContain('isStaticChildren ? jsxs : jsx')
    expect(source).toContain("from '/abs/react/jsx-runtime.js'")
    expect(source).not.toContain('/abs/react/jsx-dev-runtime.js')
  })

  it('keeps the real dev runtime wrapper for dev builds', () => {
    const source = jsxDevRuntimeEntrySource({
      production: false,
      jsxRuntimeAbs: '/abs/react/jsx-runtime.js',
      jsxDevRuntimeAbs: '/abs/react/jsx-dev-runtime.js',
    })

    expect(source).toContain('/abs/react/jsx-dev-runtime.js')
    expect(source).toContain('JsxDevRuntime')
  })
})
