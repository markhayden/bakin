# Skill-bundle fixtures (#687)

Vendored inputs for the skill-hub-interop suite — no test may hit the live network.

- `clawhub-style/` — realistic ClawHub bundle: frontmatter + `metadata.openclaw`
  requirements (env + bins + os), a shebang script, a reference file. Exercises the
  frozen translation table, exec-bit projection, and nested paths.
- `bare-style/` — minimal pi-skills-style bundle: `SKILL.md` with spec-minimum
  frontmatter, nothing else. Exercises the frontmatter fast-path + no-requirements
  path (no capability slug synthesized).
- `malicious-shaped/` — ClawHavoc-shaped content: fake "install prerequisite"
  curl-pipe-bash in the SKILL.md body, base64-decode-exec in a script, an env var
  mentioned ONLY in prose (mentions-scan material). Must trip the instruction-risk
  scan and appear verbatim in previews; must NOT be executed by anything.
- `binary-file/` — bundle containing a non-UTF-8 asset. Must be REFUSED at synthesis
  with a file list naming the binary.
- `clawhub-api/` — sanitized captures of live API responses (2026-07-27): scan
  verdicts (clean + suspicious), the ambiguous-slug matches shape. Shapes documented
  in `.claude/specs/skill-hub-interop/API-NOTES.md`.

Hostile ZIP archives (path traversal, absolute paths, symlink escape) are generated
in-test by `tests/helpers/hostile-zip.ts` — never vendored as binary files.
