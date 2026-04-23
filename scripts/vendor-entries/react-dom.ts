// Explicit named re-exports for the whole react-dom surface — both the
// bare `react-dom` entry and its `react-dom/client` subpath. See ./react.ts
// for the rationale on why explicit names are needed; additionally, we
// consolidate both specifiers into one bundle so there's exactly one copy
// of react-dom's internal state in the browser (split bundles would each
// carry their own, and shared React renderer state would diverge).
//
// This list must mirror every `exports.<name>` in react-dom's CJS entries
// (react-dom.development.js + react-dom-client.development.js). Missing
// `__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` breaks
// React internals wiring at runtime.
import ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'

export const {
  __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
} = ReactDOM

export const { createRoot, hydrateRoot, version } = ReactDOMClient

export default ReactDOM
