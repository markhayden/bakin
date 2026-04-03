import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 flex flex-col flex-1">
      <Skeleton className="h-6 w-28 mb-6" />
      <Skeleton className="h-8 w-64 rounded-lg mb-4" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div key={i} className="rounded-md bg-surface-low p-3 flex items-center gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>
    </div>
  )
}
