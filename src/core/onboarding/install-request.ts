/**
 * The ONE request shape for installing an onboarding component (#895 D11):
 * the CLI resolves every prompt locally and sends these explicit options, the
 * web hub sends the same, and the in-process path parses the same object —
 * so server and local runs cannot drift. Zod only: the CLI imports this
 * without loading any onboarding component.
 */
import { z } from 'zod'

/** Components whose install changes something. Check-only components (runtime, credentials, budget) have nothing to install. */
export const INSTALLABLE_COMPONENTS = [
  'mkdir',
  'settings',
  'search',
  'search-models',
  'media',
  'openclaw-integration',
  'plugin-assets',
  'agent-sync',
  'models',
  'recommended-plugins',
  'recommended-agents',
  'capabilities',
] as const

export type InstallableComponent = (typeof INSTALLABLE_COMPONENTS)[number]

export const OnboardingInstallOptionsSchema = z.object({
  /** The caller already has the operator's consent (`--yes`, a confirmed prompt, a one-click fix). */
  autoApprove: z.boolean().default(false),
  /** Component ids the onboarding wizard approved. */
  approvedComponents: z.array(z.string()).optional(),
  /** Official plugin ids picked in the wizard; absent means the component's defaults. */
  selectedRecommendedPluginIds: z.array(z.string()).optional(),
  /** Official agent ids picked in the wizard; absent means the component's defaults. */
  selectedRecommendedAgentIds: z.array(z.string()).optional(),
  /**
   * Claim the search service for this home. A server honours it only with a
   * matching `X-Bakin-Cli-Secret` (the operator's CLI read this home's lock).
   */
  allowServiceClaim: z.boolean().default(false),
}).strict()

export type OnboardingInstallOptions = z.infer<typeof OnboardingInstallOptionsSchema>

export const OnboardingInstallRequestSchema = z.object({
  component: z.enum(INSTALLABLE_COMPONENTS),
  options: OnboardingInstallOptionsSchema.default({ autoApprove: false, allowServiceClaim: false }),
}).strict()

export type OnboardingInstallRequest = z.infer<typeof OnboardingInstallRequestSchema>
