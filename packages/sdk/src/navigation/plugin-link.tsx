'use client'

import type { ComponentPropsWithoutRef, MouseEvent } from 'react'
import { useRouter } from './router'

export interface PluginLinkProps extends Omit<ComponentPropsWithoutRef<'a'>, 'href'> {
  /** App-relative destination, including optional query string and hash. */
  to: string
}

/**
 * Real-anchor navigation for runtime-registered plugin routes. Modified clicks,
 * downloads, and non-self targets retain native browser behavior; an
 * unmodified primary click stays inside the shared client router.
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
