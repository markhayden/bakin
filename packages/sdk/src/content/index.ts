/**
 * `@makinbakin/sdk/content` — opt-in rich content rendering and editing.
 *
 * The Markdown parser stays isolated here so routine UI and pattern consumers
 * do not pay its bundle cost.
 */

/** Render safe GFM, code, media, and visibly identified Bakin-managed sections. */
export { CodeBlock } from '@bakin/ui/content'
export type { CodeBlockLanguage, CodeBlockProps } from '@bakin/ui/content'
export { MarkdownContent } from './markdown-content'
export type { MarkdownContentProps, MarkdownInternalLinkProps } from './markdown-content'

/** Controlled edit or preview surface with semantic format and height options. */
export { MarkdownEditor } from './markdown-editor'
export type {
  MarkdownEditorFormat,
  MarkdownEditorHeight,
  MarkdownEditorMode,
  MarkdownEditorProps,
} from './markdown-editor'
