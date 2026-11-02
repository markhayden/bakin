'use client'

import { useCallback } from 'react'
import { useHostStore } from './use-host-store'

type KeyboardLock = { lock?(keys?: string[]): Promise<void>; unlock?(): void }
const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
/**
 * Which enter the browser's (asynchronous) full screen belongs to: an exit
 * or a newer enter makes an earlier request's late grant stale, so it is
 * undone instead of applied (shared by every hook instance, like the store).
 */
let request = 0

export interface FullscreenControls {
  /** The host is in full screen: its header, sidebar and activity rail are hidden. */
  active: boolean
  /** Whether the browser itself can also go full screen here (not an iPhone's Safari: there the host only hides its chrome). */
  browser: boolean
  enter(): void
  exit(): void
  toggle(): void
}

/**
 * Full screen for a page that is the point of the visit (a terminal, a
 * canvas): the host hides its own chrome — header, sidebar, activity rail —
 * and, where the browser can, the whole document goes full screen, so every
 * menu, dialog, sheet and toast still shows (they render in the document).
 * Call `enter` from the user's click (browsers require that gesture). While
 * the browser is full screen, Escape is kept for the page where the browser
 * allows it (Keyboard Lock; holding Esc still leaves). Leaving the page, the
 * browser leaving full screen, or `exit` ends it (the host owns that).
 */
export function useFullscreen(): FullscreenControls {
  const active = useHostStore((state) => state.fullscreen !== null)
  const setFullscreen = useHostStore((state) => state.setFullscreen)
  const browser = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)
  const enter = useCallback(() => {
    // Held by this page: the host ends it when the page changes.
    setFullscreen(window.location.pathname)
    if (!document.fullscreenEnabled || document.fullscreenElement) return
    // Inside the click: the request needs its user activation.
    const mine = ++request
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        // A stale grant (an exit, or a newer enter, came while the browser was still granting it) never
        // locks Esc. It is undone only when nobody holds full screen now: a newer owner keeps it (and locks
        // Esc from its own grant).
        if (mine !== request || useHostStore.getState().fullscreen === null) {
          if (useHostStore.getState().fullscreen === null && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
          return
        }
        void keyboard()?.lock?.(['Escape']).catch(() => undefined)
      })
      .catch(() => undefined)
  }, [setFullscreen])
  const exit = useCallback(() => {
    request++
    setFullscreen(null)
    keyboard()?.unlock?.()
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  }, [setFullscreen])
  const toggle = useCallback(() => { if (useHostStore.getState().fullscreen !== null) exit(); else enter() }, [enter, exit])
  return { active, browser, enter, exit, toggle }
}
