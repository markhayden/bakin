/**
 * Compatibility adapter: packaging and the public UI conformance command use
 * one CSS containment implementation and one diagnostic vocabulary.
 */
export {
  PluginCssValidationError,
  processBuiltPluginCss,
  transformPluginCss,
} from '@makinbakin/sdk/testing/ui/conformance'
export type {
  PluginCssDiagnostic,
  ProcessBuiltPluginCssInput,
  ProcessBuiltPluginCssResult,
  TransformPluginCssInput,
  TransformPluginCssResult,
} from '@makinbakin/sdk/testing/ui/conformance'
