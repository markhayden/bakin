# Messaging Plugin

Messaging is no longer a Bakin core plugin. Its source, tests, and plugin-owned documentation live in `bakin-bits-official/plugins/messaging`.

Core Bakin keeps only the stable host surface for installed plugins:
- client route slots for `/messaging/calendar` and `/messaging/brainstorm`
- `/api/plugins/messaging/*` dispatch through the plugin route registry after installation
- runtime-discovered CLI commands from the plugin manifest
- scoped storage under `plugin-data/messaging/`

Do not restore `plugins/messaging/`, `tests/plugins/messaging/`, `src/core/messaging-cron.ts`, `~/.bakin/messaging.json`, or a top-level `~/.bakin/messaging/` data path in this repo.
