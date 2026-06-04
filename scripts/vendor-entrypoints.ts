export interface JsxDevRuntimeEntryOptions {
  production: boolean
  jsxRuntimeAbs: string
  jsxDevRuntimeAbs: string
}

export function jsxDevRuntimeEntrySource(opts: JsxDevRuntimeEntryOptions): string {
  if (opts.production) {
    return `
// GENERATED. Production compatibility shim for stale installed plugin
// clients that still import react/jsx-dev-runtime. New production builds
// should emit react/jsx-runtime imports, but release binaries cannot assume
// Bun is available to rebuild every previously installed plugin.
import { jsx, jsxs, Fragment } from '${opts.jsxRuntimeAbs}'
export function jsxDEV(type, props, key, isStaticChildren) {
  return (isStaticChildren ? jsxs : jsx)(type, props, key)
}
export { Fragment }
export default { jsxDEV, Fragment }
`
  }

  return `
// GENERATED. Same rationale as jsx-runtime.
import JsxDevRuntime from '${opts.jsxDevRuntimeAbs}'
export const { jsxDEV, Fragment } = JsxDevRuntime
export default JsxDevRuntime
`
}
