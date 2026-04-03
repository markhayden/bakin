import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { CalendarItem } from '../types'
import { getContentDir } from '../../../src/core/content-dir'

const CONTENT_DIR = getContentDir()
const CALENDAR_FILE = join(CONTENT_DIR, 'calendar.json')

export function loadCalendarItems(): CalendarItem[] {
  if (!existsSync(CALENDAR_FILE)) return []
  try {
    const raw = readFileSync(CALENDAR_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function saveCalendarItems(items: CalendarItem[]): void {
  writeFileSync(CALENDAR_FILE, JSON.stringify(items, null, 2))
}

export function getItem(id: string): CalendarItem | undefined {
  return loadCalendarItems().find(i => i.id === id)
}

export function updateItem(id: string, updates: Partial<CalendarItem>): CalendarItem {
  const items = loadCalendarItems()
  const idx = items.findIndex(i => i.id === id)
  if (idx === -1) throw new Error(`Item ${id} not found`)
  items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() }
  saveCalendarItems(items)
  return items[idx]
}

export function createItem(item: Omit<CalendarItem, 'id' | 'createdAt' | 'updatedAt'>): CalendarItem {
  const items = loadCalendarItems()
  const newItem: CalendarItem = {
    ...item,
    id: Math.random().toString(36).slice(2, 10),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  items.push(newItem)
  saveCalendarItems(items)
  return newItem
}

export function deleteItem(id: string): void {
  const items = loadCalendarItems().filter(i => i.id !== id)
  saveCalendarItems(items)
}
