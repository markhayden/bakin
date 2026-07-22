'use client'

import * as React from 'react'

import { Button } from '../primitives/button'
import { Input } from '../primitives/input'
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
  align?: 'start' | 'end'
  className?: string
  inputClassName?: string
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="pointer-events-none absolute left-bakin-3 top-1/2 size-bakin-4 -translate-y-1/2 fill-none stroke-current stroke-2 text-bakin-text-muted"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" strokeLinecap="round" />
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
  className,
  disabled,
  id,
  inputClassName,
  label,
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
        'flex w-full min-w-[min(100%,14rem)] max-w-[22rem] font-bakin-typography-family-ui',
        align === 'end' ? 'justify-end' : 'justify-start',
        className,
      )}
    >
      <div
        data-slot="search-input-control"
        data-state={state}
        style={{ inlineSize: focused ? '100%' : collapsedSize }}
        className="relative max-w-full min-w-0 transition-[inline-size] duration-[var(--bakin-motion-duration-transition)] ease-bakin-standard motion-reduce:transition-none"
      >
        <SearchIcon />
        <Input
          {...inputProps}
          ref={inputRef}
          id={id}
          name={name}
          type="search"
          value={value}
          aria-label={label}
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
            'w-full overflow-hidden whitespace-nowrap pl-bakin-8 pr-bakin-8 text-ellipsis',
            '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
            inputClassName,
          )}
        />
        {value.length > 0 && !disabled && !readOnly ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-slot="search-input-clear"
            aria-label={`Clear ${label}`}
            className="absolute right-bakin-1 top-1/2 z-[1] -translate-y-1/2 text-bakin-text-muted hover:text-bakin-text-primary active:not-aria-[haspopup]:-translate-y-1/2"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onValueChange('')
              inputRef.current?.focus({ preventScroll: true })
            }}
          >
            <ClearIcon />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
