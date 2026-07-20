export type HorizontalSelectionKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

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
