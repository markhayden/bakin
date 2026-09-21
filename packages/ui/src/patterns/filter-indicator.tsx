import { createContext } from 'react'

/** Private composition context: a parent filter region already owns the icon. */
export const FilterIndicatorContext = createContext(false)

export function FilterIndicator() {
  return (
    <svg data-slot="filter-indicator" aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.6] text-bakin-text-muted">
      <path d="M2.5 3.5h11M4.5 8h7m-5 4.5h3" strokeLinecap="round" />
    </svg>
  )
}
