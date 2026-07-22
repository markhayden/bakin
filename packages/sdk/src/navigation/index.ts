/**
 * `@makinbakin/sdk/navigation` — browser navigation for runtime plugin routes.
 *
 * This entrypoint owns client links, imperative navigation, URL-backed state,
 * history-aware back behavior, and complete dirty-exit protection. Server HTTP
 * route declarations remain in `@makinbakin/sdk/routing`.
 */

/** Real-anchor SPA navigation for runtime-registered plugin routes. */
export { PluginLink } from './plugin-link'
/** Props for a runtime-route link with native anchor semantics. */
export type { PluginLinkProps } from './plugin-link'

/** Browser router hooks and plain-string URL conversion. */
export {
  toNavigationOptions,
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from './router'
/** Public browser-router contracts for string-based plugin paths. */
export type {
  Router,
  RouterNavigationOptions,
  StringNavigationOptions,
} from './router'

/** URL-backed string state with clean defaults and same-tick batching. */
export { useQueryArrayState, useQueryState } from './query-state'
/** History-aware back navigation with a cold-deep-link fallback. */
export { useHistoryBack } from './history-back'

/** Complete browser-unload, in-app route, anchor, and explicit-exit protection. */
export { useUnsavedChangesGuard } from './unsaved-changes-guard'
/** Inputs and result contract for complete unsaved-change protection. */
export type {
  UnsavedChangesGuardOptions,
  UnsavedChangesGuardResult,
} from './unsaved-changes-guard'
