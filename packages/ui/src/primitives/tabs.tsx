"use client"

import * as React from "react"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-bakin-text-muted group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-bakin-surface-elevated",
        line: "gap-1 bg-transparent",
        underline:
          "bakin-scroll-edges-x flex w-full min-w-0 max-w-full items-end justify-start gap-bakin-1 overflow-x-auto overscroll-x-contain scroll-px-bakin-4 rounded-none border-b border-bakin-border-subtle bg-transparent p-0 font-bakin-typography-family-ui group-data-horizontal/tabs:h-auto",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type TabsListVariant = NonNullable<VariantProps<typeof tabsListVariants>["variant"]>

const TabsListVariantContext = React.createContext<TabsListVariant>("default")

/**
 * Marks which sides of a horizontally scrolling strip have content past the
 * edge, so the fade only appears where there is actually more to reach.
 *
 * Background gradients paint behind text and cannot fade a clipped label, so
 * the affordance has to be a mask — and a mask needs to know the scroll
 * position. Browsers scroll the active tab into view on mount, which is
 * exactly when a long strip silently cuts its first label in half.
 */
function useScrollEdges(enabled: boolean) {
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const node = ref.current
    if (!enabled || !node) return

    const sync = () => {
      const overflowing = node.scrollWidth - node.clientWidth > 1
      const atStart = node.scrollLeft <= 1
      const atEnd = node.scrollLeft >= node.scrollWidth - node.clientWidth - 1
      node.toggleAttribute("data-overflow-start", overflowing && !atStart)
      node.toggleAttribute("data-overflow-end", overflowing && !atEnd)
    }

    sync()
    node.addEventListener("scroll", sync, { passive: true })
    // Tab sets are dynamic and containers resize; re-measure rather than
    // trusting a single mount-time reading.
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    for (const child of Array.from(node.children)) observer.observe(child)
    return () => {
      node.removeEventListener("scroll", sync)
      observer.disconnect()
    }
  }, [enabled])

  return ref
}

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  const scrollRef = useScrollEdges(variant === "underline")
  return (
    <TabsListVariantContext.Provider value={variant ?? "default"}>
      <TabsPrimitive.List
        ref={scrollRef}
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsListVariantContext.Provider>
  )
}

const tabsTriggerVariants = cva("", {
  variants: {
    variant: {
      default: [
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-bakin-text-primary/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-bakin-text-primary focus-visible:border-bakin-focus-ring focus-visible:ring-[3px] focus-visible:ring-bakin-focus-ring/50 focus-visible:outline-1 focus-visible:outline-solid focus-visible:outline-bakin-focus-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-bakin-text-muted dark:hover:text-bakin-text-primary group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-bakin-canvas-default data-active:text-bakin-text-primary dark:data-active:border-bakin-border-subtle/30 dark:data-active:bg-bakin-border-subtle/10 dark:data-active:text-bakin-text-primary",
        "after:absolute after:bg-bakin-text-primary after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
      ].join(" "),
      underline:
        "relative inline-flex min-h-(--bakin-layout-size-control) shrink-0 items-center whitespace-nowrap px-bakin-3 py-bakin-2 text-bakin-typography-size-body text-bakin-text-muted outline-none transition-colors duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard after:absolute after:inset-x-bakin-2 after:bottom-0 after:h-0.5 after:origin-center after:scale-x-0 after:bg-bakin-signal-accent after:transition-transform hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[-2px] focus-visible:outline-bakin-focus-ring disabled:pointer-events-none disabled:opacity-[var(--bakin-state-opacity-disabled)] data-active:font-bakin-typography-weight-semibold data-active:text-bakin-text-primary data-active:after:scale-x-100",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  const listVariant = React.useContext(TabsListVariantContext)
  const triggerVariant = listVariant === "underline" ? "underline" : "default"
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant: triggerVariant }), className)}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
