import { MoreHorizontal } from 'lucide-react'

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@makinbakin/sdk/ui'

export interface CollectionActionsProps {
  showActions?: boolean
  onAction: (action: string, title: string) => void
}

/** Story-only action set; callbacks are logged by Storybook, not sent to the app. */
export function CollectionActions({ title, onAction }: { title: string; onAction: CollectionActionsProps['onAction'] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" />} aria-label={`More actions for ${title}`}>
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onAction('rename', title)}>Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('duplicate', title)}>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onClick={() => onAction('archive', title)}>Archive</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
