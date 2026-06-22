/**
 * Gate decision HTML page helpers
 *
 * The durable Bakin gate-approval fallback page (server-rendered) and its
 * form/escape utilities. Used only by the gate decision routes.
 */

export function formValue(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function gateDecisionHtmlResponse(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f0f10; color: #f2f2f3; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(720px, 100%); border: 1px solid #2b2b2f; border-radius: 8px; background: #151517; padding: 24px; }
    h1 { margin: 0 0 16px; font-size: 24px; line-height: 1.2; }
    pre { white-space: pre-wrap; word-break: break-word; color: #c6c6cc; background: #101012; border: 1px solid #29292d; border-radius: 6px; padding: 16px; }
    form { margin-top: 16px; display: grid; gap: 10px; }
    label, .eyebrow { color: #8f8f98; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    textarea { resize: vertical; border-radius: 6px; border: 1px solid #35353a; background: #101012; color: #f2f2f3; padding: 10px; font: inherit; }
    button { width: fit-content; border: 0; border-radius: 6px; background: #2f6fed; color: white; padding: 10px 14px; font: inherit; font-weight: 700; cursor: pointer; }
    button.danger { background: #b42318; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .notice { color: #f6c343; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
