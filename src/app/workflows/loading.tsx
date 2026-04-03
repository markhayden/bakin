import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="p-6 flex flex-col flex-1">
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>
      <Skeleton className="flex-1 w-full rounded-lg" />
    </div>
  )
}
