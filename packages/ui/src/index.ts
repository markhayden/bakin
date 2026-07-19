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

export {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from './primitives/avatar'
export type { AvatarProps, AvatarSize, LegacyAvatarSize } from './primitives/avatar'

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './primitives/card'
export type { CardProps, CardSize, LegacyCardSize } from './primitives/card'

export { Separator } from './primitives/separator'
export type { SeparatorProps } from './primitives/separator'

export { Skeleton } from './primitives/skeleton'
export type { SkeletonProps, SkeletonShape } from './primitives/skeleton'

export { Collapsible, CollapsibleContent, CollapsibleTrigger } from './primitives/collapsible'
export type {
  CollapsibleContentProps,
  CollapsibleProps,
  CollapsibleTriggerProps,
} from './primitives/collapsible'

export { Label } from './primitives/label'
export type { LabelProps } from './primitives/label'

export { Input } from './primitives/input'
export type { InputProps } from './primitives/input'

export { Textarea } from './primitives/textarea'
export type { TextareaProps } from './primitives/textarea'

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from './primitives/input-group'
export type {
  InputGroupAddonAlign,
  InputGroupAddonProps,
  InputGroupButtonProps,
  InputGroupButtonSize,
  InputGroupInputProps,
  InputGroupProps,
  InputGroupTextProps,
  InputGroupTextareaProps,
} from './primitives/input-group'
