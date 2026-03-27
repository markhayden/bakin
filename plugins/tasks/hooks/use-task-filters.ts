'use client'

import { useMemo, useState } from 'react'
import type { Task, TaskColumns, ColumnId } from '../types'

export interface FlatTask extends Task {
  status: ColumnId
}

const COLUMN_IDS: ColumnId[] = ['todo', 'blocked', 'inProgress', 'review', 'done', 'confirmed']

function matchesSearch(task: Task, q: string): boolean {
  const lower = q.toLowerCase()
  return (
    task.title.toLowerCase().includes(lower) ||
    (task.description?.toLowerCase().includes(lower) ?? false) ||
    (task.agent?.toLowerCase().includes(lower) ?? false) ||
    task.id.toLowerCase().includes(lower)
  )
}

export function useTaskFilters(columns: TaskColumns) {
  const [search, setSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

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
    if (statusFilter !== 'all') filtered = filtered.filter(t => t.status === statusFilter)
    return filtered
  }, [columns, search, agentFilter, statusFilter])

  return {
    search, setSearch,
    agentFilter, setAgentFilter,
    statusFilter, setStatusFilter,
    filteredColumns,
    allTasksFlat,
  }
}
