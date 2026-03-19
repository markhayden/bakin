import type { MemoryDay, MemoryEntry } from '@/types'

export function parseMemoryLog(content: string): MemoryDay[] {
  const days: MemoryDay[] = []
  let currentDay: MemoryDay | null = null

  for (const line of content.split('\n')) {
    const headerMatch = line.match(/^## (\d{4}-\d{2}-\d{2})/)
    if (headerMatch) {
      currentDay = { date: headerMatch[1], entries: [] }
      days.push(currentDay)
      continue
    }
    if (currentDay && line.startsWith('- ')) {
      const text = line.replace(/^- /, '').trim()
      let type: MemoryEntry['type'] = 'note'
      if (text.startsWith('**Decision:**')) type = 'decision'
      else if (text.startsWith('**Learned:**')) type = 'learned'
      currentDay.entries.push({ type, text })
    }
  }
  return days
}
