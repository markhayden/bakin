export type HorizontalSelectionKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'
export type VerticalSelectionKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End'

export function horizontalSelectionIndex(
  disabled: readonly boolean[],
  currentIndex: number,
  key: HorizontalSelectionKey,
): number | undefined {
  if (disabled.length === 0 || disabled.every(Boolean)) return undefined
  if (key === 'Home') return disabled.findIndex((value) => !value)
  if (key === 'End') {
    for (let index = disabled.length - 1; index >= 0; index -= 1) {
      if (!disabled[index]) return index
    }
    return undefined
  }

  const direction = key === 'ArrowRight' ? 1 : -1
  let index = currentIndex
  for (let checked = 0; checked < disabled.length; checked += 1) {
    index = (index + direction + disabled.length) % disabled.length
    if (!disabled[index]) return index
  }
  return undefined
}

const VERTICAL_TO_HORIZONTAL: Record<VerticalSelectionKey, HorizontalSelectionKey> = {
  ArrowUp: 'ArrowLeft',
  ArrowDown: 'ArrowRight',
  Home: 'Home',
  End: 'End',
}

/** Vertical twin of `horizontalSelectionIndex` — same wrap and disabled-skip rules. */
export function verticalSelectionIndex(
  disabled: readonly boolean[],
  currentIndex: number,
  key: VerticalSelectionKey,
): number | undefined {
  return horizontalSelectionIndex(disabled, currentIndex, VERTICAL_TO_HORIZONTAL[key])
}
