'use client'

import { PluginHeader } from "@bakin/sdk/components"
import { FacetFilter } from "@bakin/sdk/components"
import { Button } from "@bakin/sdk/ui"
import { FileText, Image, Video, Music, Map, Database, Package, LayoutGrid, List, ListFilter, Trash2, Plus } from 'lucide-react'

const TYPE_OPTIONS = [
  { value: 'text', label: 'Text', icon: <FileText className="size-3.5" /> },
  { value: 'images', label: 'Images', icon: <Image className="size-3.5" /> },
  { value: 'video', label: 'Video', icon: <Video className="size-3.5" /> },
  { value: 'audio', label: 'Audio', icon: <Music className="size-3.5" /> },
  { value: 'plans', label: 'Plans', icon: <Map className="size-3.5" /> },
  { value: 'data', label: 'Data', icon: <Database className="size-3.5" /> },
  { value: 'other', label: 'Other', icon: <Package className="size-3.5" /> },
]

interface AssetFiltersProps {
  typeFilter: string[]
  onTypeChange: (types: string[]) => void
  search: string
  onSearchChange: (q: string) => void
  assetCount: number
  view: string
  onViewChange: (view: string) => void
  onAdd?: () => void
  /** Aggregation counts from Antfly search (type → count) */
  typeCounts?: Record<string, number>
}

const VIEW_OPTIONS = [
  { key: 'grid', label: 'Grid', icon: LayoutGrid },
  { key: 'list', label: 'List', icon: List },
  { key: 'trash', label: 'Trash', icon: Trash2 },
] as const

export function AssetFilters({ typeFilter, onTypeChange, search, onSearchChange, assetCount, view, onViewChange, onAdd, typeCounts }: AssetFiltersProps) {
  return (
    <div className="flex flex-col gap-3">
      <PluginHeader
        title="Assets"
        count={assetCount}
        search={{ value: search, onChange: onSearchChange, placeholder: 'Search assets...' }}
        actions={
          <div className="flex items-center gap-2">
            {onAdd && (
              <Button size="sm" variant="outline" onClick={onAdd}>
                <Plus className="size-3.5 mr-1.5" />
                Add
              </Button>
            )}
            <div className="flex items-center bg-muted/50 rounded-lg p-0.5">
            {VIEW_OPTIONS.map(opt => {
              const Icon = opt.icon
              return (
                <button
                  key={opt.key}
                  onClick={() => onViewChange(opt.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    view === opt.key
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="size-3.5" />
                  {opt.label}
                </button>
              )
            })}
            </div>
          </div>
        }
      />

      {view !== 'trash' && (
        <div className="flex items-center gap-3">
          <ListFilter className="size-3.5 text-muted-foreground shrink-0" />
          <FacetFilter
            label="Type"
            options={TYPE_OPTIONS}
            selected={typeFilter}
            onChange={onTypeChange}
            counts={typeCounts}
          />
        </div>
      )}
    </div>
  )
}
