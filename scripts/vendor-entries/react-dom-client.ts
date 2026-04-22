// Explicit named re-exports for react-dom/client. See ./react.ts for the
// rationale.
import ReactDOMClient from 'react-dom/client'

export const { createRoot, hydrateRoot, version } = ReactDOMClient

export default ReactDOMClient
