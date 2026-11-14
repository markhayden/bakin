import { createContext, use } from 'react'

/** The face every new agent starts with, served by the host. */
export const AGENT_FACE = '/bakin-agent.png'

/**
 * Where Bakin's pig is loaded from. The host serves it; a UI fixture, which
 * runs without the host's files, points it at a picture of its own.
 */
export const AgentFaceSourceContext = createContext(AGENT_FACE)

/**
 * A face, front and center, over a soft glow in the accent color. `size` is
 * in rem. Without `src` it is Bakin's pig, a cut-out that floats free. With
 * `src` it is an agent's own avatar: a picture someone made, so it is
 * framed and cropped to fill.
 */
export function AgentFace({ size = 10, src }: { size?: number; src?: string }) {
  const pig = use(AgentFaceSourceContext)
  return (
    <div
      aria-hidden="true"
      className="relative flex shrink-0 items-center justify-center"
      style={{
        inlineSize: `${size}rem`,
        blockSize: `${size}rem`,
        background: 'radial-gradient(closest-side, color-mix(in srgb, var(--bakin-color-signal-accent) 26%, transparent), transparent)',
      }}
    >
      {src
        ? <img src={src} alt="" className="rounded-bakin-overlay border border-bakin-border-subtle object-cover" style={{ inlineSize: '72%', blockSize: '72%' }} />
        : <img src={pig} alt="" className="size-full object-contain" />}
    </div>
  )
}
