'use client'

import { Input } from '@/components/ui/input'
import { PluginHeader } from '@/components/plugin-header'
import { Search, FileText, Image, Video, Music, Map, Database, Package, LayoutGrid, List, Trash2 } from 'lucide-react'

const TYPE_TABS = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'text', label: 'Text', icon: FileText },
  { id: 'images', label: 'Images', icon: Image },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'plans', label: 'Plans', icon: Map },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'other', label: 'Other', icon: Package },
] as const

interface AssetFiltersProps {
  typeFilter: string
  onTypeChange: (type: string) => void
  search: string
  onSearchChange: (q: string) => void
  assetCount: number
  view: 'grid' | 'list'
  onViewChange: (view: 'grid' | 'list') => void
}

export function AssetFilters({ typeFilter, onTypeChange, search, onSearchChange, assetCount, view, onViewChange }: AssetFiltersProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <PluginHeader title="Assets" />
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{assetCount} asset{assetCount !== 1 ? 's' : ''}</span>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search assets..."
              className="pl-9 h-8 bg-surface border-border"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 w-fit">
          {TYPE_TABS.map(tab => {
            const Icon = tab.icon
            const isActive = typeFilter === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => onTypeChange(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle — hidden in trash view */}
          {typeFilter !== 'trash' && (
            <div className="flex items-center bg-muted/50 rounded-lg p-0.5">
              <button
                onClick={() => onViewChange('grid')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  view === 'grid'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <LayoutGrid className="size-3.5" />
                Grid
              </button>
              <button
                onClick={() => onViewChange('list')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  view === 'list'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <List className="size-3.5" />
                List
              </button>
            </div>
          )}

          <button
            onClick={() => onTypeChange('trash')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              typeFilter === 'trash'
                ? 'bg-muted/50 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Trash2 className="size-3.5" />
            Trash
          </button>
        </div>
      </div>
    </div>
  )
}
