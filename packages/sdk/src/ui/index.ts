/**
 * `@makinbakin/sdk/ui` — shadcn base UI primitives for plugin authors.
 *
 * These are re-exports from Bakin's `src/components/ui/*`. At Bakin build time
 * they resolve to source. At plugin build time (Phase 3) the plugin author
 * marks `@makinbakin/sdk` and `@makinbakin/sdk/ui` as externals so the plugin bundle
 * doesn't duplicate these. At runtime the browser's import map resolves the
 * externals to Bakin's bundled copy.
 */
export * from '@/components/ui/alert'
export * from '@/components/ui/avatar'
export * from '@/components/ui/badge'
export * from '@/components/ui/button'
export * from '@/components/ui/card'
export * from '@/components/ui/checkbox'
export * from '@/components/ui/collapsible'
export * from '@/components/ui/command'
export * from '@/components/ui/dialog'
export * from '@/components/ui/dropdown-menu'
export * from '@/components/ui/form'
export * from '@/components/ui/input'
export * from '@/components/ui/input-group'
export * from '@/components/ui/label'
export * from '@/components/ui/popover'
export * from '@/components/ui/progress'
export * from '@/components/ui/select'
export * from '@/components/ui/separator'
export * from '@/components/ui/sheet'
export * from '@/components/ui/skeleton'
export * from '@/components/ui/switch'
export * from '@/components/ui/table'
export * from '@/components/ui/tabs'
export * from '@/components/ui/textarea'
export * from '@/components/ui/tooltip'
