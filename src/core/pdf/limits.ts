/** Shared caps for the PDF engine — assets extraction and the pdf exec tools
 * import these so the two surfaces can never drift. */

/**
 * Hard cap on extracted content length. A 50K-char doc produces roughly
 * 100 embedding chunks at 200 tokens each — plenty of semantic coverage
 * for notes, recipes, contracts, and most documentation. Files bigger
 * than this get truncated at a safe character boundary.
 */
export const MAX_CHARS = 50_000

/** PDF pages parsed per document. Enough for long-form notes and
 * reasonably long papers; avoids pathological parses on huge PDFs. */
export const MAX_PDF_PAGES = 100

/** Pages rendered per render call — the agent can call again for more. */
export const RENDER_MAX_PAGES = 10

/** Rendered page width in px. 1568 is the vision-model input ceiling (the
 * same cap the image downscale pipeline targets) — higher resolution is
 * pixels the model never receives. */
export const RENDER_WIDTH = 1568

/** A page whose extracted text is shorter than this is likely a scanned /
 * image-only page (or blank) — readers surface render-and-view guidance. */
export const SCANNED_TEXT_THRESHOLD = 32

/** Refuse files bigger than this before slurping them into memory — the
 * engine reads whole files; a stray multi-GB path would spike the server. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024
