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
export { BakinDrawer } from '@/components/bakin-drawer'
export type { BakinDrawerProps } from '@/components/bakin-drawer'
export {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@bakin/ui'
export type { AvatarProps, AvatarSize, LegacyAvatarSize } from '@bakin/ui'
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
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@bakin/ui'
export type { CardProps, CardSize, LegacyCardSize } from '@bakin/ui'
export { Checkbox } from '@bakin/ui'
export type { CheckboxProps } from '@bakin/ui'
export { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@bakin/ui'
export type { CollapsibleContentProps, CollapsibleProps, CollapsibleTriggerProps } from '@bakin/ui'
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
} from '@bakin/ui'
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
} from '@bakin/ui'
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
} from '@bakin/ui'
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
} from '@bakin/ui'
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
} from '@bakin/ui'
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
} from '@bakin/ui'
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
} from '@bakin/ui'
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
} from '@bakin/ui'
export { Banner, SystemState, Toast, ToastRegion, systemStateDefaults } from '@bakin/ui'
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
} from '@bakin/ui'
export { Input } from '@bakin/ui'
export type { InputProps } from '@bakin/ui'
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '@bakin/ui'
export type {
  InputGroupAddonAlign,
  InputGroupAddonProps,
  InputGroupButtonProps,
  InputGroupButtonSize,
  InputGroupInputProps,
  InputGroupProps,
  InputGroupTextProps,
  InputGroupTextareaProps,
} from '@bakin/ui'
export { Label } from '@bakin/ui'
export type { LabelProps } from '@bakin/ui'
export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverPortal,
  PopoverTitle,
  PopoverTrigger,
} from '@bakin/ui'
export type {
  PopoverContentProps,
  PopoverDescriptionProps,
  PopoverHeaderProps,
  PopoverPortalProps,
  PopoverProps,
  PopoverTitleProps,
  PopoverTriggerProps,
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
} from '@bakin/ui'
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
} from '@bakin/ui'
export { Separator } from '@bakin/ui'
export type { SeparatorProps } from '@bakin/ui'
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
} from '@bakin/ui'
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
} from '@bakin/ui'
export { Skeleton } from '@bakin/ui'
export type { SkeletonProps, SkeletonShape } from '@bakin/ui'
export { Switch } from '@bakin/ui'
export type { SwitchProps, SwitchSize } from '@bakin/ui'
export * from '@/components/ui/table'
export * from '@/components/ui/tabs'
export { Textarea } from '@bakin/ui'
export type { TextareaProps } from '@bakin/ui'
export { Tooltip, TooltipContent, TooltipPortal, TooltipProvider, TooltipTrigger } from '@bakin/ui'
export type {
  TooltipContentProps,
  TooltipPortalProps,
  TooltipProps,
  TooltipProviderProps,
  TooltipTriggerProps,
} from '@bakin/ui'
