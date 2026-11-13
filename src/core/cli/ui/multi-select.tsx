import { Box, Text, useInput } from 'ink'
import { useEffect, useRef } from 'react'
import { Section } from './tui'
import { CLI_COLORS } from './style-tokens'

export interface MultiSelectItem {
  id: string
  label: string
  description?: string
  selected?: boolean
  disabled?: boolean
  note?: string
}

export interface MultiSelectState {
  focusIndex: number
  selectedIds: Set<string>
}

export type MultiSelectAction =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'toggle' }

export function createMultiSelectState(items: readonly MultiSelectItem[]): MultiSelectState {
  const focusIndex = Math.max(0, items.findIndex(item => !item.disabled))
  return {
    focusIndex,
    selectedIds: new Set(items.filter(item => item.selected && !item.disabled).map(item => item.id)),
  }
}

function nextEnabledIndex(items: readonly MultiSelectItem[], from: number, direction: 1 | -1): number {
  if (items.length === 0) return 0
  for (let offset = 1; offset <= items.length; offset++) {
    const index = (from + direction * offset + items.length) % items.length
    if (!items[index].disabled) return index
  }
  return Math.max(0, from)
}

export function updateMultiSelectState(
  state: MultiSelectState,
  items: readonly MultiSelectItem[],
  action: MultiSelectAction,
): MultiSelectState {
  if (items.length === 0) return state

  switch (action.type) {
    case 'up':
      return { ...state, focusIndex: nextEnabledIndex(items, state.focusIndex, -1) }
    case 'down':
      return { ...state, focusIndex: nextEnabledIndex(items, state.focusIndex, 1) }
    case 'toggle': {
      const item = items[state.focusIndex]
      if (!item || item.disabled) return state
      const selectedIds = new Set(state.selectedIds)
      if (selectedIds.has(item.id)) selectedIds.delete(item.id)
      else selectedIds.add(item.id)
      return { ...state, selectedIds }
    }
  }
}

export interface MultiSelectProps {
  title: string
  items: MultiSelectItem[]
  state: MultiSelectState
  onChange: (state: MultiSelectState) => void
  onSubmit: (selectedIds: string[]) => void
  marginTop?: number
  showTitle?: boolean
}

/** The box in front of a row: checked, unchecked, or not a choice here. */
function checkbox(item: MultiSelectItem, selectedIds: ReadonlySet<string>): string {
  if (item.disabled) return '[-]'
  return selectedIds.has(item.id) ? '[\u2714]' : '[ ]'
}

/**
 * A checklist. Every row starts with its box, so what is selected reads
 * down the left edge; the pointer marks the row the keys act on.
 */
export function MultiSelect({
  title,
  items,
  state,
  onChange,
  onSubmit,
  marginTop = 0,
  showTitle = true,
}: MultiSelectProps) {
  // Keys can arrive faster than React re-renders (a quick down-then-space):
  // each one acts on the state the last one left, not on the last render's.
  const latest = useRef(state)
  useEffect(() => {
    latest.current = state
  }, [state])
  const apply = (action: MultiSelectAction) => {
    latest.current = updateMultiSelectState(latest.current, items, action)
    onChange(latest.current)
  }
  useInput((input, key) => {
    if (key.upArrow) apply({ type: 'up' })
    else if (key.downArrow) apply({ type: 'down' })
    else if (input === ' ') apply({ type: 'toggle' })
    else if (key.return) onSubmit(items.filter(item => !item.disabled && latest.current.selectedIds.has(item.id)).map(item => item.id))
  })

  const body = (
    <>
      <Text dimColor>Use up/down to move, space to select, enter to continue.</Text>
      <Box flexDirection="column">
        {items.map((item, index) => {
          const focused = !item.disabled && index === state.focusIndex
          const selected = !item.disabled && state.selectedIds.has(item.id)
          return (
            <Box key={item.id} gap={1}>
              <Box flexShrink={0}>
                <Text color={focused ? CLI_COLORS.info : undefined}>{focused ? '\u276f' : ' '}</Text>
              </Box>
              <Box flexShrink={0}>
                <Text color={selected ? CLI_COLORS.info : undefined} dimColor={!selected}>{checkbox(item, state.selectedIds)}</Text>
              </Box>
              <Box flexShrink={0}>
                <Text bold={!item.disabled} color={focused ? CLI_COLORS.info : undefined} dimColor={item.disabled}>{item.label}</Text>
              </Box>
              <Box flexShrink={1}>
                <Text dimColor wrap="wrap">
                  {[item.description, item.disabled && item.note ? `(${item.note})` : ''].filter(Boolean).join(' ')}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    </>
  )

  return (
    <Box flexDirection="column" marginTop={marginTop}>
      {showTitle ? <Section title={title} marginTop={0}>{body}</Section> : body}
    </Box>
  )
}
