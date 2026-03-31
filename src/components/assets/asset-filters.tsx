'use client'

import { PluginHeader } from '@/components/plugin-header'
import { FacetFilter } from '@/components/facet-filter'
import { FileText, Image, Video, Music, Map, Database, Package, LayoutGrid, List, ListFilter, Trash2 } from 'lucide-react'

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
  view: 'grid' | 'list'
  onViewChange: (view: 'grid' | 'list') => void
  isTrash: boolean
  onTrashToggle: () => void
}

export function AssetFilters({ typeFilter, onTypeChange, search, onSearchChange, assetCount, view, onViewChange, isTrash, onTrashToggle }: AssetFiltersProps) {
  return (
    <div className="flex flex-col gap-3">
      <PluginHeader
        title="Assets"
        count={assetCount}
        search={{ value: search, onChange: onSearchChange, placeholder: 'Search assets...' }}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ListFilter className="size-3.5 text-muted-foreground shrink-0" />
          <FacetFilter
            label="Type"
            options={TYPE_OPTIONS}
            selected={typeFilter}
            onChange={onTypeChange}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle — hidden in trash view */}
          {!isTrash && (
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
            onClick={onTrashToggle}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              isTrash
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
