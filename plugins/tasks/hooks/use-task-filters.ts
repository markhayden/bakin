'use client'

import { useMemo } from 'react'
import type { Task, TaskColumns, ColumnId } from '../types'

export interface FlatTask extends Task {
  status: ColumnId
}

const COLUMN_IDS: ColumnId[] = ['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived']

function matchesSearch(task: Task, q: string): boolean {
  const lower = q.toLowerCase()
  return (
    task.title.toLowerCase().includes(lower) ||
    (task.description?.toLowerCase().includes(lower) ?? false) ||
    (task.agent?.toLowerCase().includes(lower) ?? false) ||
    task.id.toLowerCase().includes(lower)
  )
}

interface TaskFilterState {
  search: string
  agentFilter: string
  statusFilter: string[]
}

export function useTaskFilters(columns: TaskColumns, state: TaskFilterState) {
  const { search, agentFilter, statusFilter } = state

  const filteredColumns = useMemo(() => {
    const result = {} as TaskColumns
    for (const colId of COLUMN_IDS) {
      let tasks = columns[colId]
      if (search) tasks = tasks.filter(t => matchesSearch(t, search))
      if (agentFilter !== 'all') tasks = tasks.filter(t => t.agent === agentFilter)
      result[colId] = tasks
    }
    return result
  }, [columns, search, agentFilter])

  const allTasksFlat = useMemo(() => {
    const flat: FlatTask[] = []
    for (const colId of COLUMN_IDS) {
      for (const task of columns[colId]) {
        flat.push({ ...task, status: colId })
      }
    }
    let filtered = flat
    if (search) filtered = filtered.filter(t => matchesSearch(t, search))
    if (agentFilter !== 'all') filtered = filtered.filter(t => t.agent === agentFilter)
    if (statusFilter.length > 0) filtered = filtered.filter(t => statusFilter.includes(t.status))
    return filtered
  }, [columns, search, agentFilter, statusFilter])

  return { filteredColumns, allTasksFlat }
}
