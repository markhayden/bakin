/**
 * Side-effect stylesheet imports (`import './styles.css'`) are bundled by
 * Bakin's plugin builder. TypeScript 6 checks such imports for resolvable
 * declarations, so declare the module shape once here.
 */
declare module '*.css'
