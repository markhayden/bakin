---
name: verify
description: Boot an isolated Bakin server from source and drive its HTTP surface to verify changes end-to-end without touching the real ~/.bakin or the production server on 3737.
---

# Verify — isolated Bakin boot recipe

The production server usually occupies port 3737 and REAL `~/.bakin`.
Never verify against it. Boot a throwaway instance instead:

```bash
VHOME=$(mktemp -d /tmp/bakin-verify-XXXXXX)
BAKIN_HOME=$VHOME BAKIN_SKIP_ONBOARDING_CHECK=1 PORT=3799 BAKIN_DISABLE_FILE_LOG=1 \
  nohup bun run server.ts serve > /tmp/bakin-verify-server.log 2>&1 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3799/api/plugins/manifest
```

Gotchas (learned the hard way — see memory files):
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
