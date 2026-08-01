/**
 * Legacy host bridge for root `src/components/ui/*` compatibility shims.
 * Product and plugin consumers should use their existing supported imports;
 * only the host package and SDK may reach the private implementation.
 */
export { Button, buttonVariants } from '@bakin/ui'
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  ButtonVariantOptions,
  LegacyButtonSize,
  LegacyButtonVariant,
} from '@bakin/ui'

export {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from '@bakin/ui'
export type {
  ProgressIndicatorProps,
  ProgressProps,
  ProgressSize,
  ProgressTone,
  ProgressTrackProps,
} from '@bakin/ui'

export { Alert, AlertAction, AlertDescription, AlertTitle, alertVariants } from '@bakin/ui'
export type {
  AlertProps,
  AlertTone,
  AlertVariantOptions,
  LegacyAlertVariant,
} from '@bakin/ui'

export { Badge, badgeVariants } from '@bakin/ui'
export type {
  BadgeProps,
  BadgeSize,
  BadgeTone,
  BadgeVariant,
  BadgeVariantOptions,
  LegacyBadgeVariant,
} from '@bakin/ui'
