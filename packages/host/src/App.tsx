/**
 * Placeholder Bakin host shell.
 *
 * Filled in at TC2 (port app shell layout from src/app/layout.tsx +
 * src/components/layout/*). For TC1 this just proves the build + mount
 * path works — `Hello from @bakin/host` rendered means main.mjs loaded,
 * React hydrated, and the import map (once wired) resolved.
 */
export function App() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Hello from @bakin/host</h1>
        <p className="text-sm text-muted-foreground">
          Phase C scaffold — TanStack Router and the real shell land at TC2/TC3.
        </p>
      </div>
    </div>
  )
}
