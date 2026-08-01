/**
 * Client-safe bridge for the shared browser-notification helper.
 *
 * Browser components import this through the plugin's own lib boundary
 * instead of reaching into host internals directly (same pattern as
 * `lib/team-token.ts`). Behavior is identical — this is purely an import
 * boundary.
 */
export { sendBrowserNotification } from '../../../src/lib/browser-notify'
