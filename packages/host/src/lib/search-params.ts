/**
 * Compatibility adapter for the routing-overhaul PR3 plain-string contract.
 * SDK host-shell plumbing owns the implementation so the host and external
 * plugin fixture router cannot drift without expanding the plugin-author
 * navigation API just for test infrastructure.
 */
export {
  parseSearchPlain,
  stringifySearchPlain,
} from '@makinbakin/sdk/internal'
