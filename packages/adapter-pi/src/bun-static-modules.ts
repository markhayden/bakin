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
 * together (same rule as the PR #854 SDK bump).
 */
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import { setBedrockProviderModule } from '@earendil-works/pi-ai/compat'

registerBunOAuthFlows()
setBedrockProviderModule(bedrockProviderModule)
