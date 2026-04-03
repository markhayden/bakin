import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-[5px] flex flex-col h-full min-w-0 overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-4 pb-3">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
      <div className="px-6 space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="rounded-lg bg-surface-low p-4 flex items-center gap-4">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-32 ml-auto" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}
