'use client'

/**
 * Clipboard write that works OUTSIDE secure contexts. Bakin is served over
 * plain HTTP on the tailnet, where `navigator.clipboard` is UNDEFINED — the
 * old `navigator.clipboard?.writeText(...)` pattern silently no-opped on
 * every copy button (the 2026-07-25 chat copy bug). Async Clipboard API
 * when available, legacy execCommand('copy') via an off-screen textarea
 * otherwise. Returns whether the copy actually happened so UIs only show
 * the success check for a real copy.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission denied or transient failure — fall through to legacy.
    }
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    const selection = document.getSelection()
    const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    // Focus BEFORE select — execCommand('copy') targets the focused
    // element's selection in several engines; select() alone can leave the
    // copy aimed at the previously-focused element.
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    // Restore whatever the user had selected before the hidden-textarea trick.
    if (previousRange && selection) {
      selection.removeAllRanges()
      selection.addRange(previousRange)
    }
    return ok
  } catch {
    return false
  }
}
