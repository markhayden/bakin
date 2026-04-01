export default function WorkflowDetailLoading() {
  return (
    <div className="flex h-full flex-col animate-pulse">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <div className="h-4 w-4 rounded bg-zinc-800" />
        <div className="h-5 w-48 rounded bg-zinc-800" />
      </div>
      <div className="flex-1 bg-zinc-950" />
    </div>
  )
}
