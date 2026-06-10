/**
 * Shared, runtime-agnostic media-transport shims.
 *
 * Owned by no plugin and no runtime: runtime adapters compose these when they
 * cannot serve a media request natively (the "gap-fill" path in the
 * media-generation adapter architecture). Future modalities (video, audio) add
 * sibling transports here and re-export them through this barrel.
 *
 * See .claude/knowledge/media-generation-adapter-architecture.md.
 */
export * from './image-format'
export * from './direct-image-provider'
export * from './secret-store'
