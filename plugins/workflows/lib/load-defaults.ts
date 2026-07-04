/**
 * Loader for plugin-shipped workflow defaults — moved to
 * `@bakin/core/workflows/load-defaults` so plugins that ship
 * `defaults/workflows/` (e.g. images) register them without a cross-plugin
 * import. Re-exported here so plugin-internal consumers keep this module as
 * their import surface.
 */
export {
  loadDefaultWorkflows,
  type LoadDefaultsResult,
} from '@bakin/core/workflows/load-defaults'
