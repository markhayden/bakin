/**
 * `@makinbakin/sdk/ui` — supported Bakin UI primitives for plugin authors.
 *
 * Migrated components resolve to the private design-system implementation;
 * compatibility exports continue to resolve to their legacy host components
 * until each owned migration lands. Plugin builds externalize this entrypoint
 * so the browser import map can provide the host's single shared copy.
 */
export { Alert, AlertAction, AlertDescription, AlertTitle, alertVariants } from '@bakin/ui'
export type {
  AlertProps,
  AlertTone,
  AlertVariantOptions,
  LegacyAlertVariant,
} from '@bakin/ui'
export * from '@/components/ui/avatar'
export { Badge, badgeVariants } from '@bakin/ui'
export type {
  BadgeProps,
  BadgeSize,
  BadgeTone,
  BadgeVariant,
  BadgeVariantOptions,
  LegacyBadgeVariant,
} from '@bakin/ui'
export { Button, buttonVariants } from '@bakin/ui'
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  ButtonVariantOptions,
  LegacyButtonSize,
  LegacyButtonVariant,
} from '@bakin/ui'
export * from '@/components/ui/card'
export * from '@/components/ui/checkbox'
export * from '@/components/ui/collapsible'
export * from '@/components/ui/command'
export * from '@/components/ui/dialog'
export * from '@/components/ui/dropdown-menu'
export * from '@/components/ui/form'
export * from '@/components/ui/input'
export * from '@/components/ui/input-group'
export * from '@/components/ui/label'
export * from '@/components/ui/popover'
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
export * from '@/components/ui/select'
export * from '@/components/ui/separator'
export * from '@/components/ui/sheet'
export * from '@/components/ui/skeleton'
export * from '@/components/ui/switch'
export * from '@/components/ui/table'
export * from '@/components/ui/tabs'
export * from '@/components/ui/textarea'
export * from '@/components/ui/tooltip'
