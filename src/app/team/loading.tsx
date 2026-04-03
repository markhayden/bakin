import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 flex flex-col flex-1">
      <Skeleton className="h-6 w-20 mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div key={i} className="rounded-lg bg-surface-low p-4 space-y-3">
            <Skeleton className="h-24 w-24 rounded-full mx-auto" />
            <Skeleton className="h-5 w-2/3 mx-auto" />
            <Skeleton className="h-3 w-1/2 mx-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}
