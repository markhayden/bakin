---
title: Bakin Docs
description: Technical documentation for installing, running, extending, and contributing to Bakin.
template: splash
hero:
  tagline: Self-hosted mission control for agent work.
  image:
    file: ../../assets/bakin-logo.svg
  actions:
    - text: Install Bakin
      link: /start/install/
      icon: right-arrow
    - text: Build a Plugin
      link: /extend/plugins/overview/
      icon: external
---

import { Card, CardGrid } from '@astrojs/starlight/components'

Bakin is a local-first dashboard, backend, CLI, and extension system for running agent work with OpenClaw.

<CardGrid>
  <Card title="Start" icon="setting">
    Install the released `bakin` binary, complete initial setup, start the server, and operate the local instance.
  </Card>
  <Card title="Core" icon="document">
    Use tasks, workflows, projects, assets, schedule, messaging, memory, models, team, and health.
  </Card>
  <Card title="Extend Bakin" icon="puzzle">
    Build plugins, author agent packages, use the SDK, register hooks and slots, and ship tested examples.
  </Card>
  <Card title="Reference" icon="setting">
    Find generated CLI, API, SDK, hook, slot, settings, plugin, and exec/MCP references.
  </Card>
</CardGrid>
