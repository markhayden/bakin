# Bakin API

Docs version: Bakin 1.0.0

Audience: coding agents and technical authors.

Canonical docs: https://makinbakin.com/docs/

HTTP API docs are generated from docs-aware route definitions and emitted as OpenAPI 3.1 at /docs/openapi.json. Public inputs are validated with Zod at runtime where handlers define schemas. Structured outputs are validated in tests, docs generation, or development checks where practical.
