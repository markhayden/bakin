import type { CalendarDay, CalendarEvent, RecurringEvent } from '@/types'

export function parseCalendar(content: string): { days: CalendarDay[]; recurring: RecurringEvent[] } {
  const days: CalendarDay[] = []
  const recurring: RecurringEvent[] = []
  let currentDay: CalendarDay | null = null
  let inRecurring = false

  for (const line of content.split('\n')) {
    const headerMatch = line.match(/^## (.+)/)
    if (headerMatch) {
      const header = headerMatch[1].trim()
      if (header.toLowerCase() === 'recurring') {
        inRecurring = true
        currentDay = null
        continue
      }
      inRecurring = false
      const labelMatch = header.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)/)
      if (labelMatch) {
        currentDay = { date: labelMatch[1], label: labelMatch[2]?.replace(/^\(|\)$/g, '').trim() || undefined, events: [] }
        days.push(currentDay)
      }
      continue
    }
    if (line.startsWith('- ')) {
      const text = line.replace(/^- /, '').trim()
      if (inRecurring) {
        const schedMatch = text.match(/^(.+?) — (.+)/)
        if (schedMatch) {
          recurring.push({ schedule: schedMatch[1], text: schedMatch[2] })
        } else {
          recurring.push({ schedule: '', text })
        }
      } else if (currentDay) {
        const timeMatch = text.match(/^(\d{1,2}:\d{2}\s*\w*)\s*—\s*(.+)/)
        if (timeMatch) {
          currentDay.events.push({ time: timeMatch[1].trim(), text: timeMatch[2].trim() })
        } else {
          currentDay.events.push({ text })
        }
      }
    }
  }
  return { days, recurring }
}
