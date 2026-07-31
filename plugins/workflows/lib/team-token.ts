/**
 * Client-safe bridge for the shared team-step-token helpers.
 *
 * Browser components import these through the plugin's own lib boundary
 * instead of reaching into `@bakin/core` directly (same pattern as
 * `hooks/use-notification-channels.ts`). Pure string helpers — safe in
 * both bundles.
 */
export { isTeamStepToken, teamIdFromToken } from '@bakin/core/workflows/team-token'
