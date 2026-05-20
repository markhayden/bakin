import { renderToString as inkRenderToString, type RenderToStringOptions } from 'ink'
import type { ReactNode } from 'react'

export const DEFAULT_TUI_COLUMNS = 120

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function resolveTuiColumns(columns?: number): number {
  if (isPositiveFiniteNumber(columns)) return Math.floor(columns)
  if (isPositiveFiniteNumber(process.stdout.columns)) return Math.floor(process.stdout.columns)
  return DEFAULT_TUI_COLUMNS
}

export function renderTuiToString(node: ReactNode, options: RenderToStringOptions = {}): string {
  return inkRenderToString(node, {
    ...options,
    columns: resolveTuiColumns(options.columns),
  })
}

export { renderTuiToString as renderToString }
