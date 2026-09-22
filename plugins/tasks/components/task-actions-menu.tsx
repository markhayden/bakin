'use client'

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@makinbakin/sdk/ui'
import { Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'

/** Shared by the task detail drawer and both task-table renders. */
export function TaskActionsMenu({ label = 'Task actions', onEdit, onDuplicate, onDelete }: {
  label?: string
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} />}>
      <MoreHorizontal aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {onEdit && <DropdownMenuItem onClick={onEdit}><Pencil aria-hidden="true" />Edit</DropdownMenuItem>}
      {onDuplicate && <DropdownMenuItem onClick={onDuplicate}><Copy aria-hidden="true" />Duplicate</DropdownMenuItem>}
      {onDelete && <>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onClick={onDelete}><Trash2 aria-hidden="true" />Delete</DropdownMenuItem>
      </>}
    </DropdownMenuContent>
  </DropdownMenu>
}
