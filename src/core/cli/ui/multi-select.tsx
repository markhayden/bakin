import { Badge, MultiSelect as InkMultiSelect, ThemeProvider, defaultTheme, extendTheme } from '@inkjs/ui'
import { Box, Text } from 'ink'
import { BAKIN_PINK } from './report'

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
}

const multiSelectTheme = extendTheme(defaultTheme, {
  components: {
    MultiSelect: {
      styles: {
        focusIndicator: () => ({ color: BAKIN_PINK }),
        selectedIndicator: () => ({ color: BAKIN_PINK }),
        label: ({ isFocused }: { isFocused: boolean }) => ({
          color: isFocused ? BAKIN_PINK : undefined,
        }),
      },
    },
  },
})

function optionLabel(item: MultiSelectItem): string {
  const name = `[${item.label}]`
  return item.description ? `${name} ${item.description}` : name
}

export function MultiSelect({ title, items, state, onChange, onSubmit, marginTop = 0 }: MultiSelectProps) {
  const enabledItems = items.filter(item => !item.disabled)
  const disabledItems = items.filter(item => item.disabled)
  const options = enabledItems.map(item => ({
    value: item.id,
    label: optionLabel(item),
  }))

  return (
    <Box flexDirection="column" marginTop={marginTop}>
      <Badge color={BAKIN_PINK}>{title}</Badge>
      <Text dimColor>Use up/down to move, space to select, enter to continue.</Text>
      <Box flexDirection="column">
        <ThemeProvider theme={multiSelectTheme}>
          <InkMultiSelect
            options={options}
            defaultValue={[...state.selectedIds]}
            visibleOptionCount={Math.max(5, Math.min(8, options.length || 5))}
            onChange={(selectedIds) => {
              onChange({ ...state, selectedIds: new Set(selectedIds) })
            }}
            onSubmit={onSubmit}
          />
        </ThemeProvider>
        {disabledItems.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {disabledItems.map(item => (
              <Text key={item.id} color="gray">
                {optionLabel(item)}{item.note ? ` (${item.note})` : ''}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}
