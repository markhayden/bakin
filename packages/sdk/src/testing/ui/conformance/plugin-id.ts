/** Published plugin ids follow the manifest contract. */
export const PUBLISHED_PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/

/** The copyable official author scaffold is intentionally not publishable as-is. */
export const AUTHOR_TEMPLATE_PLUGIN_ID = '_template'

/** IDs accepted by local UI-authoring tools before a template is renamed. */
export function isPluginUiOwnerId(value: string): boolean {
  return value === AUTHOR_TEMPLATE_PLUGIN_ID || PUBLISHED_PLUGIN_ID_PATTERN.test(value)
}
