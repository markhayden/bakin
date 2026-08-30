'use client'

import type { AriaAttributes, ComponentPropsWithoutRef, KeyboardEvent, ReactNode } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SystemState,
  Text,
} from '@bakin/ui'
import { cn } from '@bakin/ui/utils'

import { safePresentationColor } from './presentation-color'

function AssetGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={cn('fill-none stroke-current stroke-[1.6]', className)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m5.5 17 4.2-4 2.8 2.6 2.7-2.8 3.3 4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export interface AssetPickerAsset {
  id: string
  label: string
  description?: string
  type?: string
  thumbnailSrc?: string
  disabled?: boolean
}

export type AssetPickerCollection =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; assets: readonly AssetPickerAsset[] }

export type AssetPickerView = 'grid' | 'list'
export type AssetPickerVariant = 'dialog' | 'inline'

interface AssetPickerBaseProps {
  collection: AssetPickerCollection
  query: string
  onQueryChange: (query: string) => void
  onPick: (assetId: string) => void
  onRetry?: () => void
  title?: string
  description?: string
  view?: AssetPickerView
  busy?: boolean
  toolbarAction?: ReactNode
  dropActive?: boolean
  dropZoneProps?: Omit<ComponentPropsWithoutRef<'div'>, 'children'>
  notice?: ReactNode
  searchLabel?: string
  searchPlaceholder?: string
  emptyTitle?: string
  emptyDescription?: string
  noResultsTitle?: string
  noResultsDescription?: string
  className?: string
}

type DialogAssetPickerProps = AssetPickerBaseProps & {
  variant?: 'dialog'
  open: boolean
  onOpenChange: (open: boolean) => void
}

type InlineAssetPickerProps = AssetPickerBaseProps & {
  variant: 'inline'
  open?: never
  onOpenChange?: never
}

export type AssetPickerProps = DialogAssetPickerProps | InlineAssetPickerProps

function AssetThumbnail({ asset, view }: { asset: AssetPickerAsset; view: AssetPickerView }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-bakin-control border border-bakin-border-subtle bg-bakin-canvas-default text-bakin-text-muted',
        view === 'grid' ? 'aspect-square w-full' : 'size-bakin-8',
      )}
    >
      {asset.thumbnailSrc ? (
        <img src={asset.thumbnailSrc} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <AssetGlyph className={view === 'grid' ? 'size-bakin-6' : 'size-bakin-4'} />
      )}
    </span>
  )
}

function AssetChoices({
  assets,
  busy,
  onPick,
  view,
}: {
  assets: readonly AssetPickerAsset[]
  busy: boolean
  onPick: (assetId: string) => void
  view: AssetPickerView
}) {
  return (
    <ul
      data-asset-picker-choices=""
      data-view={view}
      className={cn(
        'm-0 min-w-0 list-none p-0',
        view === 'grid' ? 'grid grid-cols-2 gap-bakin-2 sm:grid-cols-4' : 'grid grid-cols-1 gap-bakin-1',
      )}
    >
      {assets.map((asset) => (
        <li key={asset.id} className="min-w-0">
          <Button
            type="button"
            variant="ghost"
            disabled={busy || asset.disabled}
            onClick={() => onPick(asset.id)}
            aria-label={`Select ${asset.label}`}
            data-asset-picker-item={asset.id}
            className={cn(
              'h-auto min-w-0 max-w-full text-left',
              view === 'grid'
                ? 'w-full flex-col items-stretch justify-start gap-bakin-2 p-bakin-2'
                : 'w-full justify-start gap-bakin-3 px-bakin-2 py-bakin-2',
            )}
          >
            <AssetThumbnail asset={asset} view={view} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-bakin-text-primary">{asset.label}</span>
              {asset.description ? (
                <Text as="span" size="meta" tone="muted" className="mt-bakin-1 block truncate">
                  {asset.description}
                </Text>
              ) : null}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

function AssetPickerPanel({
  busy = false,
  collection,
  dropActive = false,
  dropZoneProps,
  emptyDescription = 'Add an asset to the library, then return here to choose it.',
  emptyTitle = 'No assets yet',
  noResultsDescription = 'Try another search or clear the current query.',
  noResultsTitle = 'No assets match your search',
  notice,
  onPick,
  onQueryChange,
  onRetry,
  query,
  searchLabel = 'Search assets',
  searchPlaceholder = 'Search assets…',
  toolbarAction,
  view = 'grid',
}: AssetPickerBaseProps) {
  const normalizedQuery = query.trim().toLowerCase()
  const visible = collection.status === 'ready'
    ? collection.assets.filter((asset) => {
      if (!normalizedQuery) return true
      return [asset.id, asset.label, asset.description, asset.type]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery))
    })
    : []
  const { className: dropClassName, ...resolvedDropProps } = dropZoneProps ?? {}

  return (
    <div data-asset-picker-panel="" className="grid min-w-0 gap-bakin-4">
      <div
        {...resolvedDropProps}
        data-drop-active={dropActive || undefined}
        className={cn(
          'flex min-w-0 flex-col gap-bakin-2 rounded-bakin-control border border-bakin-border-subtle bg-bakin-canvas-default p-bakin-2 transition-colors sm:flex-row sm:items-center',
          dropActive && 'border-bakin-focus-ring',
          dropClassName,
        )}
      >
        {toolbarAction ? <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">{toolbarAction}</div> : null}
        <Input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label={searchLabel}
          placeholder={searchPlaceholder}
          disabled={busy}
          data-asset-picker-search=""
          className="min-w-0 sm:ml-auto sm:max-w-xs"
        />
      </div>

      {notice ? (
        <Alert tone="danger">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="max-h-96 min-w-0 overflow-y-auto overscroll-contain" data-asset-picker-results="">
        {collection.status === 'loading' ? (
          <SystemState
            kind="loading"
            scope="section"
            title="Loading assets"
            description="The available asset library will appear here."
            preview={(
              <div className={view === 'grid' ? 'grid grid-cols-2 gap-bakin-2 sm:grid-cols-4' : 'grid gap-bakin-2'}>
                {Array.from({ length: view === 'grid' ? 8 : 4 }, (_, index) => (
                  <Skeleton key={index} className={view === 'grid' ? 'aspect-square' : 'h-bakin-8'} />
                ))}
              </div>
            )}
          />
        ) : collection.status === 'error' ? (
          onRetry ? (
            <SystemState
              kind="error"
              recovery="available"
              scope="section"
              title="Couldn't load your assets"
              description={collection.message ?? 'The asset library is unavailable right now.'}
              action={<Button type="button" variant="outline" onClick={onRetry}>Try again</Button>}
            />
          ) : (
            <SystemState
              kind="error"
              recovery="unavailable"
              scope="section"
              title="Couldn't load your assets"
              description={collection.message ?? 'The asset library is unavailable right now.'}
            />
          )
        ) : visible.length > 0 ? (
          <AssetChoices assets={visible} busy={busy} onPick={onPick} view={view} />
        ) : normalizedQuery ? (
          <SystemState
            kind="no-results"
            scope="section"
            title={noResultsTitle}
            description={noResultsDescription}
            action={<Button type="button" variant="outline" onClick={() => onQueryChange('')}>Clear search</Button>}
          />
        ) : (
          <SystemState kind="initial-empty" scope="section" title={emptyTitle} description={emptyDescription} />
        )}
      </div>
    </div>
  )
}

/** Controlled asset chooser with dialog and inline compositions and no endpoint ownership. */
export function AssetPicker(props: AssetPickerProps) {
  const title = props.title ?? 'Choose an asset'
  const description = props.description ?? 'Search the available library and choose one asset.'

  if (props.variant === 'inline') {
    return (
      <section aria-label={title} data-asset-picker="" data-variant="inline" className={cn('grid min-w-0 gap-bakin-3', props.className)}>
        <header className="grid min-w-0 gap-bakin-1">
          <h2 className="m-0 [font-size:var(--bakin-typography-size-title)] font-bakin-typography-weight-semibold text-bakin-text-primary">{title}</h2>
          <Text as="p" tone="muted">{description}</Text>
        </header>
        <AssetPickerPanel {...props} />
      </section>
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={(open) => props.onOpenChange(open)} busy={props.busy}>
      <DialogContent data-asset-picker="" data-variant="dialog" className={cn('max-w-3xl', props.className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <AssetPickerPanel {...props} />
      </DialogContent>
    </Dialog>
  )
}

export const DEFAULT_MODEL_VALUE = '__default__'

export interface ModelSelectOption {
  id: string
  name: string
  provider?: string
  disabled?: boolean
}

export interface ModelSelectProps extends Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> {
  id?: string
  name?: string
  value: string
  onValueChange: (value: string) => void
  models: readonly ModelSelectOption[]
  defaultLabel?: string
  defaultValue?: string
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  required?: boolean
  className?: string
}

function providerLabel(provider: string): string {
  return provider.replace(/[-_]/g, ' ')
}

/** Controlled provider-grouped model choice with no catalog or persistence ownership. */
export function ModelSelect({
  id,
  name,
  value,
  onValueChange,
  models,
  defaultLabel,
  defaultValue = DEFAULT_MODEL_VALUE,
  placeholder = 'Select a model…',
  ariaLabel,
  disabled = false,
  required = false,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: ModelSelectProps) {
  const grouped = models.reduce<Record<string, ModelSelectOption[]>>((groups, model) => {
    const provider = model.provider?.trim() || 'other'
    ;(groups[provider] ??= []).push(model)
    return groups
  }, {})
  const providers = Object.keys(grouped).sort((left, right) => left.localeCompare(right))
  const selectedModel = models.find((model) => model.id === value)
  const selectedLabel = value === defaultValue
    ? defaultLabel
    : selectedModel?.name ?? (value || undefined)
  const hasOptions = Boolean(defaultLabel) || models.length > 0

  return (
    <Select
      name={name}
      value={value}
      onValueChange={(next) => onValueChange(next ?? '')}
      disabled={disabled || !hasOptions}
      required={required}
    >
      <SelectTrigger
        id={id}
        size="sm"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className={className ?? 'w-full'}
      >
        <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {defaultLabel ? <SelectItem value={defaultValue}>{defaultLabel}</SelectItem> : null}
        {providers.map((provider) => (
          <SelectGroup key={provider}>
            <SelectLabel>{providerLabel(provider)}</SelectLabel>
            {grouped[provider].map((model) => (
              <SelectItem key={model.id} value={model.id} disabled={model.disabled}>{model.name}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

export interface ColorPickerOption {
  value: string
  label: string
  color: string
  disabled?: boolean
}

export interface ColorPickerProps extends Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> {
  value: string
  onValueChange: (value: string) => void
  options: readonly ColorPickerOption[]
  ariaLabel?: string
  columns?: 4 | 6 | 8
  disabled?: boolean
  className?: string
}

/**
 * `columns` caps swatches per row; the row WRAPS when the container is
 * narrower than the cap (320px at 200% text zoom must never overflow).
 */
function colorRowCap(columns: NonNullable<ColorPickerProps['columns']>): string {
  return `calc(${columns} * var(--bakin-layout-size-control) + ${columns - 1} * var(--bakin-layout-space-2))`
}

function adjacentColorIndex(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  options: readonly ColorPickerOption[],
): number | null {
  const enabled = options.map((option, optionIndex) => ({ option, optionIndex })).filter(({ option }) => !option.disabled)
  const current = enabled.findIndex(({ optionIndex }) => optionIndex === index)
  if (current < 0 || enabled.length === 0) return null
  if (event.key === 'Home') return enabled[0].optionIndex
  if (event.key === 'End') return enabled.at(-1)!.optionIndex
  const direction = ['ArrowRight', 'ArrowDown'].includes(event.key)
    ? 1
    : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0
  if (!direction) return null
  return enabled[(current + direction + enabled.length) % enabled.length].optionIndex
}

/** Accessible controlled color-choice group; consumers own the palette values. */
export function ColorPicker({
  value,
  onValueChange,
  options,
  ariaLabel = 'Choose color',
  columns = 6,
  disabled = false,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: ColorPickerProps) {
  const selectedEnabledIndex = options.findIndex((option) => option.value === value && !option.disabled)
  const tabStopIndex = disabled
    ? -1
    : selectedEnabledIndex >= 0 ? selectedEnabledIndex : options.findIndex((option) => !option.disabled)

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
      data-color-picker=""
      className={cn('flex min-w-0 flex-wrap gap-bakin-2', className)}
      style={{ maxInlineSize: colorRowCap(columns) }}
    >
      {options.map((option, index) => {
        const selected = value === option.value
        const color = safePresentationColor(option.color)
        return (
          <Button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            tabIndex={index === tabStopIndex ? 0 : -1}
            disabled={disabled || option.disabled}
            variant="ghost"
            size="icon"
            data-color-option={option.value}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              const nextIndex = adjacentColorIndex(event, index, options)
              if (nextIndex == null) return
              event.preventDefault()
              const next = options[nextIndex]
              onValueChange(next.value)
              const group = event.currentTarget.closest('[role="radiogroup"]')
              const buttons = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
              buttons?.[nextIndex]?.focus()
            }}
            className="relative rounded-bakin-pill outline-offset-2"
          >
            <svg aria-hidden="true" viewBox="0 0 32 32" className="size-bakin-8">
              {color ? (
                <circle cx="16" cy="16" r="14" fill={color} className="stroke-bakin-border-subtle stroke-1" />
              ) : (
                <circle cx="16" cy="16" r="14" className="fill-none stroke-bakin-border-subtle stroke-1" />
              )}
            </svg>
            {selected ? (
              <svg aria-hidden="true" viewBox="0 0 16 16" className="absolute size-bakin-4 fill-none stroke-bakin-canvas-default stroke-[2.25] drop-shadow">
                <path d="m3.25 8.25 3 3 6.5-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </Button>
        )
      })}
    </div>
  )
}
