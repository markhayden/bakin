/**
 * Private presentation implementation for Bakin product and SDK UI.
 *
 * This workspace package is not a plugin-author contract. Supported consumers
 * reach implementations through focused `@makinbakin/sdk/*` entrypoints.
 */
export { PrivateUiBoundaryProbe } from './private-ui-boundary-probe'
export type { PrivateUiBoundaryProbeProps } from './private-ui-boundary-probe'

export { Button, buttonVariants } from './primitives/button'
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  ButtonVariantOptions,
  LegacyButtonSize,
  LegacyButtonVariant,
} from './primitives/button'

export { Badge, badgeVariants } from './primitives/badge'
export type {
  BadgeProps,
  BadgeSize,
  BadgeTone,
  BadgeVariant,
  BadgeVariantOptions,
  LegacyBadgeVariant,
} from './primitives/badge'

export { Alert, AlertAction, AlertDescription, AlertTitle, alertVariants } from './primitives/alert'
export type {
  AlertProps,
  AlertTone,
  AlertVariantOptions,
  LegacyAlertVariant,
} from './primitives/alert'

export {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from './primitives/progress'
export type {
  ProgressIndicatorProps,
  ProgressProps,
  ProgressSize,
  ProgressTone,
  ProgressTrackProps,
} from './primitives/progress'
