import { useEffect } from 'react'

/** Window event the header button (or anything else) fires to open the overlay. */
export const OPEN_GLOBAL_SEARCH_EVENT = 'bakin:open-global-search'

export function openGlobalSearch(): void {
  window.dispatchEvent(new CustomEvent(OPEN_GLOBAL_SEARCH_EVENT))
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * ⌘K / Ctrl+K opens the global search overlay. Skips when focus is in an
 * editable control — typing "k" in a form must never hijack.
 */
export function useSearchHotkey(onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      onOpen()
    }
    const onOpenEvent = () => onOpen()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(OPEN_GLOBAL_SEARCH_EVENT, onOpenEvent)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(OPEN_GLOBAL_SEARCH_EVENT, onOpenEvent)
    }
  }, [onOpen])
}
