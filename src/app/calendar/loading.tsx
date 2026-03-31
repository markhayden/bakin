import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 flex flex-col flex-1">
      {/* Header with nav + toggle */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-7 w-7 rounded" />
        </div>
        <Skeleton className="h-7 w-48 rounded-lg" />
      </div>
      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px flex-1">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="bg-surface-low rounded p-2 min-h-[80px]">
            <Skeleton className="h-3 w-4 mb-2" />
            {i % 5 === 0 && <Skeleton className="h-4 w-full rounded" />}
          </div>
        ))}
      </div>
    </div>
  )
}
