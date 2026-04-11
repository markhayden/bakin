'use client'

import { useMemo } from 'react'
import { useAntflySearch, reorderByAntflyResults, type AntflySearchResult } from '@/hooks/use-antfly-search'
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

function reorderColumn(tasks: Task[], antflyResults: AntflySearchResult[]): Task[] {
  return reorderByAntflyResults(tasks, antflyResults)
}

interface TaskFilterState {
  search: string
  agentFilter: string
  statusFilter: string[]
}

export function filterBoardColumns(columns: TaskColumns, search: string, agentFilter: string, antflyResults?: AntflySearchResult[]): TaskColumns {
  const result = {} as TaskColumns
  const matchIds = antflyResults?.length ? new Set(antflyResults.map(r => r.id)) : null

  for (const colId of COLUMN_IDS) {
    let tasks = columns[colId]
    if (search) {
      if (matchIds) {
        tasks = tasks.filter(t => matchIds.has(t.id))
      } else {
        tasks = tasks.filter(t => matchesSearch(t, search))
      }
    }
    if (agentFilter !== 'all') tasks = tasks.filter(t => t.agent === agentFilter)
    if (antflyResults?.length) tasks = reorderColumn(tasks, antflyResults)
    result[colId] = tasks
  }

  return result
}

export function useTaskFilters(columns: TaskColumns, state: TaskFilterState) {
  const { search, agentFilter, statusFilter } = state

  const antfly = useAntflySearch({
    table: 'tasks',
    facets: ['status', 'agent', 'created_by'],
    debounce: 300,
  })

  // Fire Antfly search when search text changes
  useMemo(() => {
    if (search) antfly.search(search)
    else antfly.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const filteredColumns = useMemo(() => {
    return filterBoardColumns(columns, search, agentFilter, antfly.results)
  }, [columns, search, agentFilter, antfly.results])

  const allTasksFlat = useMemo(() => {
    const flat: FlatTask[] = []
    for (const colId of COLUMN_IDS) {
      for (const task of columns[colId]) {
        flat.push({ ...task, status: colId })
      }
    }
    let filtered = flat
    if (search) {
      if (antfly.results.length) {
        const matchIds = new Set(antfly.results.map(r => r.id))
        filtered = filtered.filter(t => matchIds.has(t.id))
      } else {
        filtered = filtered.filter(t => matchesSearch(t, search))
      }
    }
    if (agentFilter !== 'all') filtered = filtered.filter(t => t.agent === agentFilter)
    if (statusFilter.length > 0) filtered = filtered.filter(t => statusFilter.includes(t.status))
    if (antfly.results.length) filtered = reorderByAntflyResults(filtered, antfly.results)
    return filtered
  }, [columns, search, agentFilter, statusFilter, antfly.results])

  return { filteredColumns, allTasksFlat, aggregations: antfly.aggregations }
}
