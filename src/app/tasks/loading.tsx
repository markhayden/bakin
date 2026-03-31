import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-[5px] flex flex-col h-full min-w-0 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-[25px] pt-4 pb-3">
        <div className="space-y-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-24 rounded-lg" />
          <Skeleton className="h-7 w-24 rounded-lg" />
        </div>
      </div>
      {/* Filter row */}
      <div className="px-[25px] pb-3 flex items-center gap-3">
        <Skeleton className="h-7 w-56 rounded-md" />
        <Skeleton className="h-7 w-64 rounded-lg" />
      </div>
      {/* Kanban columns */}
      <div className="flex-1 flex gap-3 px-[25px] overflow-hidden">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex-1 rounded-lg bg-surface-low p-3 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-20 w-full rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
