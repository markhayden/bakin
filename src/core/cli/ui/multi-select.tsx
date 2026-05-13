import { Box, Text, useInput } from 'ink'

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
}

export function MultiSelect({ title, items, state, onChange, onSubmit }: MultiSelectProps) {
  useInput((_input, key) => {
    if (key.upArrow) onChange(updateMultiSelectState(state, items, { type: 'up' }))
    else if (key.downArrow) onChange(updateMultiSelectState(state, items, { type: 'down' }))
    else if (key.return) onSubmit([...state.selectedIds])
    else if (_input === ' ') onChange(updateMultiSelectState(state, items, { type: 'toggle' }))
  })

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Text dimColor>Use up/down to move, space to select, enter to continue.</Text>
      <Box flexDirection="column" marginTop={1}>
        {items.map((item, index) => {
          const focused = index === state.focusIndex
          const selected = state.selectedIds.has(item.id)
          const marker = item.disabled ? '-' : selected ? 'x' : ' '
          return (
            <Box key={item.id} flexDirection="column">
              <Text color={item.disabled ? 'gray' : focused ? 'cyan' : undefined}>
                {focused ? '>' : ' '} [{marker}] {item.label}{item.note ? ` (${item.note})` : ''}
              </Text>
              {item.description ? <Text dimColor>      {item.description}</Text> : null}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
