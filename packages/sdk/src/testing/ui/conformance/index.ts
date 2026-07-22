/**
 * `@makinbakin/sdk/testing/ui/conformance` — plugin UI test configuration,
 * findings, reports, and the programmatic one-command runner.
 */
export {
  PLUGIN_UI_CONFORMANCE_RULES,
  definePluginUiConformance,
  formatPluginUiFinding,
  renderPluginUiConformanceHtml,
} from './contracts'
export type {
  PluginUiConformanceConfig,
  PluginUiConformanceConfigInput,
  PluginUiConformanceEnforcement,
  PluginUiConformanceFinding,
  PluginUiConformanceReport,
  PluginUiConformanceRule,
  PluginUiConformanceScreenshot,
  RunPluginUiConformanceOptions,
} from './contracts'

/** Run the complete deterministic browser conformance suite on demand. */
export async function runPluginUiConformance(
  options: import('./contracts').RunPluginUiConformanceOptions = {},
): Promise<import('./contracts').PluginUiConformanceReport> {
  const runner = await import('./runner')
  return runner.runPluginUiConformance(options)
}

/** The exact CSS isolation transform reused by plugin packaging. */
export {
  PluginCssValidationError,
  processBuiltPluginCss,
  transformPluginCss,
} from './plugin-css'
export type {
  PluginCssDiagnostic,
  ProcessBuiltPluginCssInput,
  ProcessBuiltPluginCssResult,
  TransformPluginCssInput,
  TransformPluginCssResult,
} from './plugin-css'
