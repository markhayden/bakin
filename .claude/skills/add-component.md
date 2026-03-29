# Add Component

Create a new UI component following the Bakin design system patterns.

## Usage

Provide: component name, location (shared `ui/` or plugin-specific), purpose.

## Steps

1. Determine location:
   - **Shared base component** → `src/components/ui/{name}.tsx`
   - **Plugin-specific** → `plugins/{pluginId}/components/{name}.tsx`
   - **Layout component** → `src/components/layout/{name}.tsx`

2. Create the component following shadcn/ui patterns:

```typescript
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const componentVariants = cva(
  'base-classes-here',
  {
    variants: {
      variant: {
        default: 'variant-classes',
        secondary: 'variant-classes',
      },
      size: {
        default: 'size-classes',
        sm: 'size-classes',
        lg: 'size-classes',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

interface ComponentProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof componentVariants> {}

function Component({ className, variant, size, ...props }: ComponentProps) {
  return (
    <div
      data-slot="component-name"
      className={cn(componentVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Component, componentVariants }
```

## Design System Rules

- **Use CSS custom properties** from `globals.css` via Tailwind — never hardcode color values
- **Use `cn()` utility** (from `src/lib/utils.ts`) for class merging
- **Use CVA** for variant management when the component has multiple visual states
- **Add `data-slot` attribute** for semantic identification (shadcn convention)
- **TypeScript props** extend the appropriate HTML element attributes
- **Tailwind CSS 4** classes — use the design token scale (e.g., `rounded-md`, `text-sm`, `bg-card`)
- **Dark mode first** — the app is dark-mode-only currently

## Key Design Tokens

From `globals.css`:
- Background: `bg-background` (#0a0a0a)
- Surface: `bg-card` (#141414)
- Text: `text-foreground` (#ededef)
- Muted text: `text-muted-foreground`
- Border: `border-border` (rgba(255,255,255,0.08))
- Accent: `bg-accent` (#5e6ad2 indigo)
- Destructive: `text-destructive` (#ef4444)
- Radius scale: `rounded-sm` through `rounded-4xl`

## Checklist
- [ ] Component uses `cn()` for class merging
- [ ] CVA used if component has variants
- [ ] `data-slot` attribute added
- [ ] Props extend appropriate HTML element attributes
- [ ] No hardcoded colors — all via Tailwind tokens
- [ ] Component exported as named export
