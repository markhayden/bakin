/**
 * Publish-only runtime entry for `@makinbakin/sdk`.
 *
 * The public source barrel also re-exports SDK types. Core consumes those
 * types, and Bun 1.3 can mistake that type-only package cycle for a runtime
 * re-export cycle when the barrel itself is the build entry, producing names
 * with no declarations. Keep the publish runtime graph explicit here while
 * declarations continue to come from `packages/sdk/src/index.ts`.
 */
export {
  getNavBadge,
  registerPlugin,
  registerPluginCleanup,
  setNavBadge,
} from '../packages/sdk/src/register'
export { defineCoreRoute, definePlugin, defineRoute } from '../packages/sdk/src/routing'
