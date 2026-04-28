import type { StorageAdapter } from '@bakin/sdk/types'
import type { CalendarItem } from '../types'

const MESSAGING_FILE = 'messaging.json'

export interface MessagingStorage {
  loadMessagingItems(): CalendarItem[]
  saveMessagingItems(items: CalendarItem[]): void
  getItem(id: string): CalendarItem | undefined
  updateItem(id: string, updates: Partial<CalendarItem>): CalendarItem
  createItem(item: Omit<CalendarItem, 'id' | 'createdAt' | 'updatedAt'>): CalendarItem
  deleteItem(id: string): void
}

function readJson<T>(storage: StorageAdapter, path: string, fallback: T): T {
  try {
    if (storage.readJson) return storage.readJson<T>(path) ?? fallback
    const raw = storage.read(path)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson(storage: StorageAdapter, path: string, value: unknown): void {
  if (storage.writeJson) storage.writeJson(path, value)
  else storage.write(path, JSON.stringify(value, null, 2))
}

export function createMessagingStorage(storage: StorageAdapter): MessagingStorage {
  function loadMessagingItems(): CalendarItem[] {
    const parsed = readJson<unknown>(storage, MESSAGING_FILE, [])
    return Array.isArray(parsed) ? parsed as CalendarItem[] : []
  }

  function saveMessagingItems(items: CalendarItem[]): void {
    writeJson(storage, MESSAGING_FILE, items)
  }

  function getItem(id: string): CalendarItem | undefined {
    return loadMessagingItems().find(i => i.id === id)
  }

  function updateItem(id: string, updates: Partial<CalendarItem>): CalendarItem {
    const items = loadMessagingItems()
    const idx = items.findIndex(i => i.id === id)
    if (idx === -1) throw new Error(`Item ${id} not found`)
    items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() }
    saveMessagingItems(items)
    return items[idx]
  }

  function createItem(item: Omit<CalendarItem, 'id' | 'createdAt' | 'updatedAt'>): CalendarItem {
    const items = loadMessagingItems()
    const newItem: CalendarItem = {
      ...item,
      id: Math.random().toString(36).slice(2, 10),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    items.push(newItem)
    saveMessagingItems(items)
    return newItem
  }

  function deleteItem(id: string): void {
    const items = loadMessagingItems().filter(i => i.id !== id)
    saveMessagingItems(items)
  }

  return {
    loadMessagingItems,
    saveMessagingItems,
    getItem,
    updateItem,
    createItem,
    deleteItem,
  }
}
