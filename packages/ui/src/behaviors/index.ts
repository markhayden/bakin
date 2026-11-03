/**
 * `@bakin/ui/behaviors` — render-safe state helpers the SDK's hooks entry
 * re-exports. A dedicated subpath so that entry reaches only these files,
 * never the whole UI barrel (the browser payload ratchet measures what an
 * entry can reach).
 */
export { useKeyedState } from './use-keyed-state'
export { useMediaQuery } from './use-media-query'
export { useNow } from './use-now'
