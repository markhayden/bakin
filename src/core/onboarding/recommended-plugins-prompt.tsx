/**
 * Ink-based interactive prompt for selecting recommended plugins during
 * `bakin onboard` (Phase 6). Renders a checkbox list keyed by plugin id;
 * keyboard handlers mirror the standard TUI checklist UX.
 *
 * Inputs:
 *   ↑ / ↓ / k / j   → navigate up/down
 *   space           → toggle the cursor's plugin in/out of the selection
 *   a               → toggle ALL (select all if any unchecked, else
 *                     deselect all)
 *   enter           → submit; resolves with the array of selected ids
 *   esc / q         → cancel; resolves with empty array
 *
 * The component renders inline (no fullscreen takeover); the `bakin
 * onboard` orchestrator awaits the resolution before printing the
 * final progress summary.
 *
 * Tested via ink-testing-library (see tests/core/onboarding/
 * recommended-plugins-prompt.test.tsx) — `stdin.write('[A')` for
 * arrow up, `[B'` for arrow down, ` ` for space, `\r` for enter.
 */
import React, { useState } from 'react'
import { Box, Text, render, useApp, useInput } from 'ink'
import type { RecommendedPlugin } from './types'

interface PromptProps {
  plugins: readonly RecommendedPlugin[]
  onSubmit: (selected: string[]) => void
}

function PluginsPrompt({ plugins, onSubmit }: PromptProps): React.ReactElement {
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(plugins.filter((p) => p.defaultSelected).map((p) => p.id)),
  )
  const { exit } = useApp()

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setCursor((c) => (c <= 0 ? plugins.length - 1 : c - 1))
      return
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => (c >= plugins.length - 1 ? 0 : c + 1))
      return
    }
    if (input === ' ') {
      setSelected((prev) => {
        const next = new Set(prev)
        const id = plugins[cursor]?.id
        if (!id) return prev
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      return
    }
    if (input === 'a') {
      setSelected((prev) => {
        if (prev.size < plugins.length) {
          return new Set(plugins.map((p) => p.id))
        }
        return new Set()
      })
      return
    }
    if (key.return) {
      // Return ids in the original plugins-array order so callers
      // see deterministic, display-order output rather than Set
      // insertion-order (which depends on how the user toggled).
      onSubmit(plugins.filter((p) => selected.has(p.id)).map((p) => p.id))
      exit()
      return
    }
    if (key.escape || input === 'q') {
      onSubmit([])
      exit()
      return
    }
  })

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Recommended plugins</Text>
        <Text dimColor> — ↑/↓ navigate, space toggle, a toggle all, enter confirm, esc cancel</Text>
      </Text>
      {plugins.map((plugin, idx) => {
        const isCursor = idx === cursor
        const isSelected = selected.has(plugin.id)
        const checkbox = isSelected ? '[x]' : '[ ]'
        const cursorMark = isCursor ? '>' : ' '
        return (
          <Box key={plugin.id} flexDirection="column">
            <Text>
              <Text color={isCursor ? 'cyan' : undefined}>{cursorMark} </Text>
              <Text>{checkbox} </Text>
              <Text bold={isCursor}>{plugin.name}</Text>
              <Text dimColor> ({plugin.id})</Text>
            </Text>
            <Box marginLeft={6}>
              <Text dimColor>{plugin.description}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * Render the prompt against the user's TTY and resolve when they
 * submit or cancel. Caller passes the curated list; the resolved value
 * is the array of selected plugin ids in `plugins` order.
 *
 * If `plugins` is empty the prompt is skipped — resolves immediately
 * with an empty array. Same shape as a user pressing escape, so the
 * caller doesn't have to special-case empty.
 */
export async function promptRecommendedPlugins(
  plugins: readonly RecommendedPlugin[],
): Promise<string[]> {
  if (plugins.length === 0) return []

  return new Promise<string[]>((resolve) => {
    const onSubmit = (selected: string[]): void => resolve(selected)
    const { unmount, waitUntilExit } = render(
      <PluginsPrompt plugins={plugins} onSubmit={onSubmit} />,
      { exitOnCtrlC: true },
    )
    void waitUntilExit().then(() => {
      unmount()
    })
  })
}

/** Test-only export so unit tests can render against ink-testing-library. */
export { PluginsPrompt as __PluginsPromptForTest }
