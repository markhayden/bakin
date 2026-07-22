/**
 * Private presentation implementation for Bakin product and SDK UI.
 *
 * This workspace package is not a plugin-author contract. Supported consumers
 * reach implementations through focused `@makinbakin/sdk/*` entrypoints.
 */
export { PrivateUiBoundaryProbe } from './private-ui-boundary-probe'
export type { PrivateUiBoundaryProbeProps } from './private-ui-boundary-probe'

export { PageShell } from './layout/page-shell'
export type { PageShellGap, PageShellPadding, PageShellProps, PageShellWidth } from './layout/page-shell'

export { Inline, Stack } from './layout/flow'
export type {
  InlineAlign,
  InlineJustify,
  InlineProps,
  LayoutElement,
  LayoutGap,
  StackAlign,
  StackProps,
} from './layout/flow'

export { Grid } from './layout/grid'
export type { GridAlign, GridLayout, GridProps } from './layout/grid'

export { Section } from './layout/section'
export type { SectionDivider, SectionElement, SectionProps, SectionSpacing } from './layout/section'

export { BoundedOverflow } from './layout/bounded-overflow'
export type { BoundedOverflowProps } from './layout/bounded-overflow'

export {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Fieldset,
  FieldsetDescription,
  FieldsetLegend,
  Form,
  FormActions,
  SubmitButton,
} from './forms'
export type {
  FieldControlProps,
  FieldDescriptionProps,
  FieldErrorProps,
  FieldGroupProps,
  FieldLabelProps,
  FieldOrientation,
  FieldProps,
  FieldRequirement,
  FieldsetDescriptionProps,
  FieldsetLegendProps,
  FieldsetProps,
  FormActionsAlign,
  FormActionsProps,
  FormProps,
  SubmitButtonProps,
} from './forms'

export { Banner, SystemState, Toast, ToastRegion, systemStateDefaults } from './states'
export { PluginPortalOwnershipProvider } from './primitives/portal-ownership'
export type { PluginPortalOwnershipProviderProps } from './primitives/portal-ownership'
export type {
  BannerProps,
  BannerTone,
  FeedbackAnnouncement,
  SystemStateContent,
  SystemStateHeadingLevel,
  SystemStateKind,
  SystemStateProps,
  SystemStateScope,
  ToastProps,
  ToastRegionProps,
  ToastTone,
} from './states'

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

export { Checkbox } from './primitives/checkbox'
export type { CheckboxProps } from './primitives/checkbox'

export { Switch } from './primitives/switch'
export type { SwitchProps, SwitchSize } from './primitives/switch'

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './primitives/select'
export type {
  SelectContentProps,
  SelectGroupProps,
  SelectItemProps,
  SelectLabelProps,
  SelectProps,
  SelectScrollDownButtonProps,
  SelectScrollUpButtonProps,
  SelectSeparatorProps,
  SelectTriggerProps,
  SelectTriggerSize,
  SelectValueProps,
} from './primitives/select'

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './primitives/dialog'
export type {
  DialogCloseProps,
  DialogContentProps,
  DialogDescriptionProps,
  DialogFooterProps,
  DialogHeaderProps,
  DialogOverlayProps,
  DialogPortalProps,
  DialogProps,
  DialogTitleProps,
  DialogTriggerProps,
} from './primitives/dialog'

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from './primitives/sheet'
export type {
  SheetCloseProps,
  SheetContentProps,
  SheetDescriptionProps,
  SheetFooterProps,
  SheetHeaderProps,
  SheetOverlayProps,
  SheetPortalProps,
  SheetProps,
  SheetSide,
  SheetTitleProps,
  SheetTriggerProps,
} from './primitives/sheet'

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverPortal,
  PopoverTitle,
  PopoverTrigger,
} from './primitives/popover'
export type {
  PopoverContentProps,
  PopoverDescriptionProps,
  PopoverHeaderProps,
  PopoverPortalProps,
  PopoverProps,
  PopoverTitleProps,
  PopoverTriggerProps,
} from './primitives/popover'

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './primitives/dropdown-menu'
export type {
  DropdownMenuCheckboxItemProps,
  DropdownMenuContentProps,
  DropdownMenuGroupProps,
  DropdownMenuItemProps,
  DropdownMenuItemVariant,
  DropdownMenuLabelProps,
  DropdownMenuPortalProps,
  DropdownMenuProps,
  DropdownMenuRadioGroupProps,
  DropdownMenuRadioItemProps,
  DropdownMenuSeparatorProps,
  DropdownMenuShortcutProps,
  DropdownMenuSubContentProps,
  DropdownMenuSubProps,
  DropdownMenuSubTriggerProps,
  DropdownMenuTriggerProps,
} from './primitives/dropdown-menu'

export { Tooltip, TooltipContent, TooltipPortal, TooltipProvider, TooltipTrigger } from './primitives/tooltip'
export type {
  TooltipContentProps,
  TooltipPortalProps,
  TooltipProps,
  TooltipProviderProps,
  TooltipTriggerProps,
} from './primitives/tooltip'

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './primitives/command'
export type {
  CommandDialogProps,
  CommandEmptyProps,
  CommandGroupProps,
  CommandInputProps,
  CommandItemProps,
  CommandListProps,
  CommandProps,
  CommandSeparatorProps,
  CommandShortcutProps,
} from './primitives/command'
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

export { BakinDrawerSection } from './patterns/bakin-drawer-section'
export type {
  BakinDrawerSectionHeadingLevel,
  BakinDrawerSectionProps,
} from './patterns/bakin-drawer-section'
