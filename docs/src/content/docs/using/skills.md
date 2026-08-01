---
title: Hub Skills
description: "Install skills from ClawHub, GitHub, or anywhere the Agent Skills format lives — onto whichever runtime you run, with a real trust gate."
---

The agent ecosystem converged on one skill format — a `SKILL.md` with optional scripts and reference files. ClawHub hosts thousands of them; Pi and Anthropic publish theirs as GitHub repos. Bakin installs any of them onto whichever runtime is active, with versions pinned, provenance recorded, and a trust gate in front.

## Install: paste a link

Browse [clawhub.ai](https://clawhub.ai) or a GitHub skills repo in your browser. Copy the page URL. Then either:

```bash
bakin skills install https://clawhub.ai/steipete/skills/weather
bakin skills install github:badlogic/pi-skills#brave-search
bakin skills install ./my-local-skill
```

…or paste the same link into **Explore → Capabilities** in the dashboard — the "Install from ClawHub, GitHub, or any skills repo" box sits right above the curated catalog.

Every install shows a full preview first: the files and their sizes, the requirements Bakin recognized (API keys, binaries), the hub's security verdict, and loud warnings for anything that looks like a hidden install step. Nothing from the bundle executes at install time — ever. You approve, it installs, and the skill is available to your agents on the active runtime.

If several publishers share a slug on ClawHub, Bakin lists the owner-qualified options and you pick one.

## Trust, honestly

- **Hub-flagged malware is refused with no override.** ClawHub scans its skills; if the hub says a skill is suspicious, blocked, or removed, Bakin will not install it, full stop.
- **GitHub and local sources have no hub verdict** — the preview says so, and a deterministic scan flags patterns like `curl … | bash` in the content so you see the risk before consenting.
- **Versions are pinned.** Installs record exactly what you approved (source, version, content hash). Nothing auto-updates: re-run `bakin skills install <ref>` to update — it re-runs the whole gate.
- Skills that need an API key show it in the preview; after install, a guided step stores the key and it takes effect immediately — no restart.

## Managing installed skills

```bash
bakin skills list            # managed skills (hub/pack) + unmanaged runtime skills
bakin skills remove weather  # unprojects and uninstalls, by name
```

The Explore → Capabilities tab shows the same list ("From the ecosystem") with one-click removal.

## When Bakin didn't recognize a requirement

Skills declare their needs in different dialects, and some only mention them in prose. When the preview says a skill mentions env-var-shaped strings Bakin didn't map:

```bash
bakin skills map weather
```

An agent reads the installed skill and proposes the missing requirements. The proposal is mechanically verified — only names that literally appear in the skill's files survive, and key slots are always minted fresh (a skill can never claim one of your existing provider keys). You approve the diff; readiness reporting then covers the skill like any capability pack.
