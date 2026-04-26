---
title: Documentation Plan
description: The implementation plan and quality bar for the Bakin documentation system.
---

The Bakin docs are built as a product artifact. Public docs live in `apps/docs`, deploy to Cloudflare Pages, and are optimized for operators, extension authors, contributors, search engines, and coding agents.

## Launch Requirements

- Public docs cover install, setup, usage, extension, architecture, contribution, security, data handling, and reference material.
- Generated reference docs are backed by structured metadata, schemas, examples, visibility, stability, and source paths.
- Examples are tested or explicitly marked illustrative with a reason.
- SEO and agent discoverability are part of CI.
- `/llms.txt`, `/llms-full.txt`, and targeted `/llms/*.md` bundles are published as plain text/Markdown assets.

## Public Surface Rule

Any released public surface must be documented before launch:

- CLI commands
- HTTP routes
- core plugin routes
- SDK exports
- hooks
- slots
- exec/MCP tools
- settings and config keys
- plugin manifest fields
- runtime file layout
- agent package contracts

Internal surfaces must be explicitly marked internal. Experimental surfaces may be public, but they must be labeled and separated from stable contracts.
