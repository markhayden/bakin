/**
 * Static registration of the pi SDK's bundler-opaque modules.
 *
 * pi-ai loads its OAuth flow modules and the bedrock provider through
 * VARIABLE import specifiers so bundlers cannot follow them (keeps Node-only
 * flow code out of browser bundles). Inside a `bun build --compile` binary
 * those dynamic imports resolve against `/$bunfs/root` and fail — on rc.30
 * every Pi turn on a compiled install died with:
 *   "OAuth auth derivation failed for openai-codex:
 *    Cannot find module './openai-codex.js'"
 *
 * The SDK's own standalone binary registers statically imported modules at
 * startup (pi-coding-agent dist/bun/runtime-setup.js); this module is
 * Bakin's equivalent, imported for its side effects from the adapter entry.
 * Harmless when running from source: the same modules are bound, just
 * statically instead of lazily.
 *
 * `@earendil-works/pi-ai` must stay version-locked to pi-coding-agent's own
 * dependency so both resolve to ONE module instance — the registration has
 * to land in the exact loader module the agent consults. Bump the two
 * together (same rule as the PR #854 SDK bump). Same version is not enough
 * under bun's isolated linker: a package is forked per peer-resolution
 * context, and pi 1.0 split pi-ai in two because openai's optional `undici`
 * peer resolved differently at the root (6.x via @discordjs/rest) than under
 * pi-coding-agent (its own 8.x). packages/adapter-pi therefore declares the
 * exact undici pi-coding-agent ships; tests/adapter-pi/compiled-oauth-static
 * pins both the single store entry and the lockstep.
 */
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import { setBedrockProviderModule } from '@earendil-works/pi-ai/compat'

registerBunOAuthFlows()
setBedrockProviderModule(bedrockProviderModule)
