'use client'

import * as React from 'react'

import type { Input } from '../primitives/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../primitives/input-group'
import { cn } from '../utils'

type NativeSearchInputProps = Omit<
  React.ComponentPropsWithoutRef<typeof Input>,
  'aria-label' | 'children' | 'className' | 'defaultValue' | 'onChange' | 'size' | 'type' | 'value'
>

export interface SearchInputProps extends NativeSearchInputProps {
  /** Durable accessible name; the placeholder is only a visual hint. */
  label: string
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  /** Indicates an in-flight search without adding layout-changing feedback beside the field. */
  busy?: boolean
  /** Uses the full available width below the desktop breakpoint, then restores compact focus expansion. */
  mobileFullWidth?: boolean
  align?: 'start' | 'end'
  className?: string
  inputClassName?: string
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="fill-none stroke-current stroke-2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" strokeLinecap="round" />
    </svg>
  )
}

function SearchProgressIcon() {
  return (
    <svg
      aria-hidden="true"
      data-slot="search-input-progress"
      viewBox="0 0 24 24"
      className="animate-spin fill-none stroke-current stroke-2 motion-reduce:animate-none"
    >
      <circle cx="12" cy="12" r="8" className="opacity-25" />
      <path d="M20 12a8 8 0 0 0-8-8" strokeLinecap="round" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.75]">
      <path d="m4 4 8 8m0-8-8 8" strokeLinecap="round" />
    </svg>
  )
}

/** Compact search that expands inside reserved layout space instead of reflowing peer controls. */
export function SearchInput({
  align = 'end',
  autoComplete,
  autoFocus,
  busy = false,
  className,
  disabled,
  id,
  inputClassName,
  label,
  mobileFullWidth = false,
  name,
  onBlur,
  onFocus,
  onValueChange,
  placeholder = 'Search…',
  readOnly,
  required,
  value,
  ...inputProps
}: SearchInputProps) {
  const [focused, setFocused] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const queryLength = Math.min(Array.from(value.trimEnd()).length, 64)
  const collapsedSize = queryLength > 0
    ? `min(100%, max(14rem, calc(${queryLength}ch + 3rem)))`
    : 'min(100%, 14rem)'
  const state = focused ? 'focused' : queryLength > 0 ? 'filled' : 'empty'

  return (
    <div
      data-slot="search-input-reserve"
      className={cn(
        'flex w-full min-w-[min(100%,14rem)] font-bakin-typography-family-ui',
        mobileFullWidth ? 'max-w-none md:max-w-[22rem]' : 'max-w-[22rem]',
        // Inside a PageHeader controls region the reserve holds a rigid
        // column instead of flexing (inert anywhere else — the container
        // query only matches under a named page-header container).
        '@3xl/page-header:w-[22rem] @3xl/page-header:shrink-0',
        align === 'end' ? 'justify-end' : 'justify-start',
        className,
      )}
    >
      <div
        data-slot="search-input-control"
        data-state={state}
        style={{ '--bakin-search-input-inline-size': focused ? '100%' : collapsedSize } as React.CSSProperties}
        className={cn(
          'max-w-full min-w-0 transition-[inline-size] duration-[var(--bakin-motion-duration-transition)] ease-bakin-standard motion-reduce:transition-none',
          mobileFullWidth
            ? '[inline-size:100%] md:[inline-size:var(--bakin-search-input-inline-size)]'
            : '[inline-size:var(--bakin-search-input-inline-size)]',
        )}
      >
        <InputGroup>
          <InputGroupAddon align="inline-start">
            {busy ? <SearchProgressIcon /> : <SearchIcon />}
          </InputGroupAddon>
          <InputGroupInput
            {...inputProps}
            ref={inputRef}
            id={id}
            name={name}
            type="search"
            value={value}
            aria-label={label}
            aria-busy={busy || undefined}
            placeholder={placeholder}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            disabled={disabled}
            readOnly={readOnly}
            required={required}
            onChange={(event) => onValueChange(event.currentTarget.value)}
            onFocus={(event) => {
              setFocused(true)
              onFocus?.(event)
            }}
            onBlur={(event) => {
              setFocused(false)
              onBlur?.(event)
            }}
            className={cn(
              'overflow-hidden whitespace-nowrap text-ellipsis',
              '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
              inputClassName,
            )}
          />
          {value.length > 0 && !disabled && !readOnly ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                data-slot="search-input-clear"
                aria-label={`Clear ${label}`}
                className="text-bakin-text-muted hover:text-bakin-text-primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onValueChange('')
                  inputRef.current?.focus({ preventScroll: true })
                }}
              >
                <ClearIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
          {busy ? <span role="status" className="sr-only">Searching {label}</span> : null}
        </InputGroup>
      </div>
    </div>
  )
}
