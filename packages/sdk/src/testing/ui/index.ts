/**
 * `@makinbakin/sdk/testing/ui` — deterministic browser fixture host.
 *
 * This browser-only subpath is intentionally separate from the Node-backed
 * `@makinbakin/sdk/testing` server harness. Import the canonical stylesheet
 * once in the fixture application before rendering `PluginUiFixtureHost`.
 */
export { PluginUiFixtureHost } from './plugin-ui-fixture-host'
export type {
  PluginUiFixtureHostProps,
  PluginUiFixtureRegistration,
  PluginUiFixtureSlot,
  PluginUiFixtureSurfaceState,
} from './plugin-ui-fixture-host'

/** Stable zero-user-state defaults for a plugin UI browser fixture. */
export { DEFAULT_PLUGIN_UI_FIXTURE } from './runtime'
/** Canonical desktop and minimum-supported mobile browser dimensions. */
export { PLUGIN_UI_VIEWPORTS } from './runtime'
/** Create repeatable monotonically increasing fixture identifiers. */
export { createDeterministicIdFactory } from './runtime'
/** Create a repeatable pseudo-random sequence from a stable string seed. */
export { createDeterministicRandom } from './runtime'
/** Serve only explicit fixture responses and reject undeclared requests. */
export { createPluginUiFixtureFetch } from './runtime'
/** Install deterministic browser globals and return their restoration function. */
export { installPluginUiFixture } from './runtime'
/** Validate and normalize a root-relative fixture application route. */
export { normalizePluginUiFixtureRoute } from './runtime'
export type {
  PluginUiFixtureNetworkResponse,
  PluginUiFixtureViewport,
  PluginUiFixtureViewportName,
  PluginUiRuntimeFixture,
} from './runtime'
