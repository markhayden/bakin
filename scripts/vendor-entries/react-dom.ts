// Explicit named re-exports for the whole react-dom surface — both the
// bare `react-dom` entry and its `react-dom/client` subpath. See ./react.ts
// for the rationale on why explicit names are needed; additionally, we
// consolidate both specifiers into one bundle so there's exactly one copy
// of react-dom's internal state in the browser (split bundles would each
// carry their own, and shared React renderer state would diverge).
import ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'

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
} = ReactDOM

export const { createRoot, hydrateRoot, version } = ReactDOMClient

export default ReactDOM
