// Shared by agent-patterns and picker-patterns: only safe CSS color forms
// (hex, rgb/hsl functions, var(--token) references, named colors) pass through to inline
// presentation styles — anything else is dropped.
const PRESENTATION_COLOR = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([0-9.,%+\-\s/]+\)|var\(--[a-z0-9][a-z0-9-]*\)|[a-z]+)$/i

/** Trimmed color when it matches a safe presentation form; otherwise undefined. */
export function safePresentationColor(value?: string): string | undefined {
  const color = value?.trim()
  return color && PRESENTATION_COLOR.test(color) ? color : undefined
}
