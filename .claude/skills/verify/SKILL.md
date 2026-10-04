---
name: verify
description: Boot an isolated Bakin server from source and drive its HTTP surface to verify changes end-to-end without touching the real ~/.bakin or the production server on 3737.
---

# Verify — isolated Bakin boot recipe

The production server usually occupies port 3737 and REAL `~/.bakin`.
Never verify against it. Boot a throwaway instance instead:

```bash
VHOME=$(mktemp -d /tmp/bakin-verify-XXXXXX)
# Keep verification on an explicit isolated endpoint. Ownership guards now
# refuse a temporary/default-home boot without touching the shared service
# or sending it HTTP; search would remain unavailable. A different origin
# is guest mode, so Bakin never manages that endpoint's service or files.
echo '{"search":{"settings":{"url":"http://127.0.0.1:39999"}}}' > "$VHOME/settings.json"
BAKIN_HOME=$VHOME BAKIN_SKIP_ONBOARDING_CHECK=1 PORT=3799 BAKIN_DISABLE_FILE_LOG=1 \
  nohup bun run server.ts serve > /tmp/bakin-verify-server.log 2>&1 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3799/api/plugins/manifest
```

Gotchas (learned the hard way — see memory files):
- Keep the guest-URL settings line for explicit verification isolation. Port 39999 is intentionally unavailable; use a dedicated test engine there when verifying search.
- Runtime turns can't be driven here: the OpenClaw adapter's gateway port is
  hardcoded (18789) and whatever owns it (production gateway / dockerized rig)
  will reject or, worse, execute them. Use `bun run instance dev --mode isolated`
  for live-turn e2e; this recipe is for REST/UI surface verification.
- `server.ts` needs the literal `serve` argument; bare `bun run server.ts` prints help and exits 0.
- `BAKIN_SKIP_ONBOARDING_CHECK=1` is required; a marker file alone won't pass the gate.
- If plugin dists are stale, run `bun run build:plugins && bun run build:assets-manifest` first —
  then stage only intended files (never `git add -A`; build-stamp trap).
- Kill by port, not pgrep (the bun script-runner wrapper swallows repeat signals):
  `kill $(lsof -t -i :3799)`.

Useful drive points:
- `GET /api/plugins/manifest` — all plugins, nav contributions, client entries, status.
- `GET /api/plugins/<id>/assets/client.js` — plugin browser bundle serves.
- `GET /api/plugins/<id>/<route>` — plugin-registered API routes.
- `GET /<page-path>` — SPA shell serves (200 text/html).

Clean up: `kill $(lsof -t -i :3799); rm -rf $VHOME`.
