'use client'

import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import type { ComponentProps } from 'react'

import { cn, mergeClassName } from '../utils'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type LegacyAvatarSize = 'default'

export type AvatarProps = Omit<AvatarPrimitive.Root.Props, 'size'> & {
  size?: AvatarSize | LegacyAvatarSize
}

function canonicalSize(size: AvatarProps['size']): AvatarSize {
  return size === 'default' || size == null ? 'md' : size
}

const avatarClasses = [
  'group/avatar relative inline-flex shrink-0 select-none overflow-visible rounded-bakin-pill',
  'bg-bakin-surface-elevated font-bakin-typography-family-ui text-bakin-text-muted',
  'ring-1 ring-inset ring-bakin-border-subtle',
  'data-[size=xs]:size-bakin-4 data-[size=sm]:size-bakin-6 data-[size=md]:size-bakin-8',
  'data-[size=lg]:size-[calc(var(--bakin-layout-space-8)+var(--bakin-layout-space-2))]',
  'data-[size=xl]:size-[calc(var(--bakin-layout-space-8)+var(--bakin-layout-space-4))]',
].join(' ')

export function Avatar({ className, size = 'md', ...props }: AvatarProps) {
  const resolvedSize = canonicalSize(size)
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={resolvedSize}
      className={mergeClassName(avatarClasses, className)}
      {...props}
    />
  )
}

export function AvatarImage({ className, alt = '', ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      alt={alt}
      className={mergeClassName('aspect-square size-full rounded-bakin-pill object-cover', className)}
      {...props}
    />
  )
}

export function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={mergeClassName(
        [
          'flex size-full items-center justify-center rounded-bakin-pill bg-bakin-surface-elevated',
          'font-bakin-typography-weight-semibold leading-none text-bakin-text-muted [text-transform:uppercase]',
          'text-[length:var(--bakin-typography-size-meta)] group-data-[size=xs]/avatar:text-[.625rem]',
          'group-data-[size=xl]/avatar:text-[length:var(--bakin-typography-size-body)]',
        ].join(' '),
        className,
      )}
      {...props}
    />
  )
}

export function AvatarBadge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        [
          'absolute bottom-0 right-0 z-10 inline-flex size-bakin-2 items-center justify-center rounded-bakin-pill',
          'bg-bakin-action-primary-background text-bakin-action-primary-foreground ring-2 ring-bakin-canvas-default',
          'group-data-[size=xs]/avatar:size-bakin-1 group-data-[size=lg]/avatar:size-bakin-3 group-data-[size=xl]/avatar:size-bakin-3',
          '[&_svg]:size-bakin-2 group-data-[size=xs]/avatar:[&_svg]:hidden',
        ].join(' '),
        className,
      )}
      {...props}
    />
  )
}

export function AvatarGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        'group/avatar-group flex -space-x-bakin-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-bakin-canvas-default',
        className,
      )}
      {...props}
    />
  )
}

export function AvatarGroupCount({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        [
          'relative flex size-bakin-8 shrink-0 items-center justify-center rounded-bakin-pill',
          'bg-bakin-surface-elevated font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted',
          'ring-2 ring-bakin-canvas-default',
          'group-has-data-[size=xs]/avatar-group:size-bakin-4 group-has-data-[size=sm]/avatar-group:size-bakin-6',
          'group-has-data-[size=lg]/avatar-group:size-[calc(var(--bakin-layout-space-8)+var(--bakin-layout-space-2))]',
          'group-has-data-[size=xl]/avatar-group:size-[calc(var(--bakin-layout-space-8)+var(--bakin-layout-space-4))]',
        ].join(' '),
        className,
      )}
      {...props}
    />
  )
}
