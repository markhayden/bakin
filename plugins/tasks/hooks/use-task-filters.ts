'use client'

import { useEffect, useMemo } from 'react'
import { useSearch, reorderBySearchResults, type SearchResult } from '@/hooks/use-search'
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

function reorderColumn(tasks: Task[], searchResults: SearchResult[]): Task[] {
  return reorderBySearchResults(tasks, searchResults)
}

interface TaskFilterState {
  search: string
  agentFilter: string
  statusFilter: string[]
}

export function filterBoardColumns(
  columns: TaskColumns,
  search: string,
  agentFilter: string,
  searchResults?: SearchResult[],
  searchLoading?: boolean,
): TaskColumns {
  const result = {} as TaskColumns
  const matchIds = searchResults?.length ? new Set(searchResults.map(r => r.id)) : null

  for (const colId of COLUMN_IDS) {
    let tasks = columns[colId]
    if (search) {
      if (matchIds) {
        tasks = tasks.filter(t => matchIds.has(t.id))
      } else if (!searchLoading) {
        // Only fall back to the local text match when the search hook has
        // settled. During the 300ms debounce window we keep the full list
        // so the board doesn't flash "no matches" before Antfly returns.
        tasks = tasks.filter(t => matchesSearch(t, search))
      }
    }
    if (agentFilter !== 'all') tasks = tasks.filter(t => t.agent === agentFilter)
    if (searchResults?.length) tasks = reorderColumn(tasks, searchResults)
    result[colId] = tasks
  }

  return result
}

export function useTaskFilters(columns: TaskColumns, state: TaskFilterState) {
  const { search, agentFilter, statusFilter } = state

  const searchHook = useSearch({
    plugin: 'tasks',
    facets: ['status', 'agent', 'created_by'],
    debounce: 300,
  })

  useEffect(() => {
    if (search) searchHook.search(search)
    else searchHook.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const filteredColumns = useMemo(() => {
    return filterBoardColumns(columns, search, agentFilter, searchHook.results, searchHook.loading)
  }, [columns, search, agentFilter, searchHook.results, searchHook.loading])

  const allTasksFlat = useMemo(() => {
    const flat: FlatTask[] = []
    for (const colId of COLUMN_IDS) {
      for (const task of columns[colId]) {
        flat.push({ ...task, status: colId })
      }
    }
    let filtered = flat
    if (search) {
      if (searchHook.results.length) {
        const matchIds = new Set(searchHook.results.map(r => r.id))
        filtered = filtered.filter(t => matchIds.has(t.id))
      } else if (!searchHook.loading) {
        // Same debounce-flash guard as filterBoardColumns — only run the
        // local fallback once the search hook has settled.
        filtered = filtered.filter(t => matchesSearch(t, search))
      }
    }
    if (agentFilter !== 'all') filtered = filtered.filter(t => t.agent === agentFilter)
    if (statusFilter.length > 0) filtered = filtered.filter(t => statusFilter.includes(t.status))
    if (searchHook.results.length) filtered = reorderBySearchResults(filtered, searchHook.results)
    return filtered
  }, [columns, search, agentFilter, statusFilter, searchHook.results, searchHook.loading])

  return {
    filteredColumns,
    allTasksFlat,
    aggregations: searchHook.aggregations,
    searchResults: searchHook.results,
    searchLoading: searchHook.loading,
  }
}
