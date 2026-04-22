// Explicit named re-exports for react-dom. See ./react.ts for the
// rationale.
import ReactDOM from 'react-dom'

export const {
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  unstable_batchedUpdates,
  version,
} = ReactDOM

export default ReactDOM
