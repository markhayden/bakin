export function isBenignTailwindLine(line: string): boolean {
  const trimmed = line.trim()
  return !trimmed
    || trimmed.startsWith('≈ tailwindcss')
    || trimmed.startsWith('Done in ')
    || trimmed === 'Resolving dependencies'
    || /^Resolved, downloaded and extracted \[\d+\]$/.test(trimmed)
    || trimmed === 'Saved lockfile'
}
