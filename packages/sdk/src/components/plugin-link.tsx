'use client'

import type { ComponentPropsWithoutRef, MouseEvent } from 'react'
import { useRouter } from '../hooks/router'

export interface PluginLinkProps extends Omit<ComponentPropsWithoutRef<'a'>, 'href'> {
  /** App-relative destination, including optional query string and hash. */
  to: string
}

/**
 * Client-side link for runtime-registered plugin routes.
 *
 * Runtime plugin paths cannot participate in the host's compile-time route
 * union. A real anchor preserves copy/open-in-new-tab semantics; unmodified
 * primary clicks go through the shared client router instead of reloading the
 * shell and every plugin.
 */
export function PluginLink({ to, onClick, target, download, ...props }: PluginLinkProps) {
  const router = useRouter()

  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || (target !== undefined && target !== '_self')
      || (download !== undefined && download !== false)
    ) return

    event.preventDefault()
    router.push(to)
  }

  return (
    <a
      href={to}
      target={target}
      download={download}
      onClick={navigate}
      {...props}
    />
  )
}
