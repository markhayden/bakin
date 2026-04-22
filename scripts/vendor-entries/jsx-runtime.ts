// Explicit named re-exports for react/jsx-runtime. See ./react.ts for the
// rationale. The automatic JSX transform calls these by name.
import JsxRuntime from 'react/jsx-runtime'

export const { jsx, jsxs, Fragment } = JsxRuntime

export default JsxRuntime
