'use client'

import { Skeleton, Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@makinbakin/sdk/ui"

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
export function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-card">
            {Array.from({ length: cols }).map((_, i) => (
              <TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, r) => (
            <TableRow key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <TableCell key={c}><Skeleton className="h-4 w-full" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function InlineEmpty({ message }: { message: string }) {
  return (
    <div className="py-6 text-center text-sm text-muted-foreground">{message}</div>
  )
}
