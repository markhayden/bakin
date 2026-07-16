# TODO: Routing Overhaul

Tracks `tasks/plan-routing-overhaul.md`. Check items off as commits land.

## PR1 — feat/routing-no-hard-nav
- [x] 1.1 Commit chat reply-toast fix (already in working tree) — `fix(chat): SPA-navigate + dismiss reply toast`
- [x] 1.2 Six raw anchors → PluginLink/Link — `fix(plugins): replace raw internal anchors with PluginLink`
- [x] 1.3 Workflows approval toast SPA + dismiss — `fix(workflows): SPA-navigate approval toast`
- [x] 1.4 globalThis navigate bridge + browser-notify fallback — `feat(sdk): navigate bridge for browser notifications`
- [x] 1.5 Arch scanner + teeth + ESLint restrictions — `test(architecture): no-hard-navigation scanner + eslint restrictions`
- [x] 1.6 Navigation-rules docs section — `docs(knowledge): navigation rules in url-state-deep-linking`
- [ ] CHECKPOINT: suite+lint+tsc green (done 2026-07-15: 7710 pass/0 fail, lint 0 errors, tsc clean) · live pass on 3737 (anchors, toasts, OS notif — SSE conn survives) · Mark approves · merge

## PR2 — feat/chat-path-routing
- [x] 2.1 Host routes chat.$chatId + chat.new + ranking test — `feat(host): /chat/$chatId and /chat/new routes`
- [x] 2.2 Chat page identity from path props; draft → /chat/new?agent= — `feat(chat): page reads identity from path; draft moves to /chat/new`
- [x] 2.3 All URL builders → path (attention.ts, toast, OS notif, ⌘K hit); zero `?chat=` grep — `feat(chat): path URLs in toast/notification/search builders`
- [x] 2.4 RTL + attention pathname table tests — `test(chat): path-based deep-link coverage`
- [x] 2.5 chat-plugin.md (+conversation-kit.md) docs — `docs(knowledge): chat-plugin URL surface`
- [ ] CHECKPOINT: suite+lint+tsc green · live pass (cold-boot deep link, draft first-send, back/forward, all three entry points) · Mark approves · merge

## PR3 — feat/router-polish
- [ ] 3.1 Query values stay strings (tests first; serializer preferred, shim fallback) — `fix(sdk): query values survive as strings through the router`
- [ ] 3.2 Multi-setter microtask batching — `fix(hooks): compose multi-setter useQueryState updates`
- [ ] 3.3 Scroll restoration (scout container first) — `feat(host): scroll restoration`
- [ ] 3.4 NotFound page + catch-all + notFoundComponent + shadow warning — `feat(host): NotFound page + route-shadow warning`
- [ ] 3.5 Docs sweep: taxonomy rewrite, delete clobber rule + stale rows, CLAUDE.md bullet, authoring docs, README check — `docs: routing taxonomy sweep`
- [ ] CHECKPOINT: suite+lint+tsc green · live pass (multi-param, string params, scroll, 404, tabs) · all spec Success Criteria 1–9 · Mark approves · merge · spec → Shipped
