# Projects foundation visual review

Approved by the user on 2026-09-23: exactly 12 PNGs, eight new contracts and four replacements.

Captured using Playwright 1.60.0, Chromium, Linux/amd64 Ubuntu Noble, dark theme, UTC, at 1440px and 320px. Only the exact manifest-pinned candidate bytes have been installed as baselines.

New contracts cover AgentSelect sizes/variants, semantic Markdown comparison, managed-section references, and restored composer draft/focus. Existing replacements show the newly visible composer keyboard outline. Existing Markdown and attachment-state baselines remain unchanged.

| Viewport | Contract | Candidate | Before / diff |
| --- | --- | --- | --- |
| desktop | agent-field-appearance | [Candidate](desktop-agent-field-appearance-candidate.png) | New contract |
| desktop | markdown-comparison | [Candidate](desktop-markdown-comparison-candidate.png) | New contract |
| desktop | managed-markdown-context | [Candidate](desktop-managed-markdown-context-candidate.png) | New contract |
| desktop | embedded-draft-handle | [Candidate](desktop-embedded-draft-handle-candidate.png) | New contract |
| desktop | foundation-conversation-composer | [Candidate](desktop-foundation-conversation-composer-actual.png) | [Before](desktop-foundation-conversation-composer-expected.png) / [Diff](desktop-foundation-conversation-composer-diff.png) |
| desktop | foundation-conversation-panel | [Candidate](desktop-foundation-conversation-panel-actual.png) | [Before](desktop-foundation-conversation-panel-expected.png) / [Diff](desktop-foundation-conversation-panel-diff.png) |
| mobile | agent-field-appearance | [Candidate](mobile-agent-field-appearance-candidate.png) | New contract |
| mobile | markdown-comparison | [Candidate](mobile-markdown-comparison-candidate.png) | New contract |
| mobile | managed-markdown-context | [Candidate](mobile-managed-markdown-context-candidate.png) | New contract |
| mobile | embedded-draft-handle | [Candidate](mobile-embedded-draft-handle-candidate.png) | New contract |
| mobile | foundation-conversation-composer | [Candidate](mobile-foundation-conversation-composer-actual.png) | [Before](mobile-foundation-conversation-composer-expected.png) / [Diff](mobile-foundation-conversation-composer-diff.png) |
| mobile | foundation-conversation-panel | [Candidate](mobile-foundation-conversation-panel-actual.png) | [Before](mobile-foundation-conversation-panel-expected.png) / [Diff](mobile-foundation-conversation-panel-diff.png) |

Exact destination paths and SHA-256 hashes are in [manifest.json](manifest.json). Approval covers only those candidate bytes. Any later changed image requires review.

Required by `.agents/skills/bakin-ui-conformance/references/conformance-contract.md`: “before/after evidence and exact explicit approval before update”.
