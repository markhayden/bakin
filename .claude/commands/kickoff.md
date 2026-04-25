For this request lets be sure we start the process with /agent-skills:spec to build a detailed spec followed by /agent-skills:plan to validate and vet the full plan. Every plan must also include a detailed commit strategy so we can add natural checkpoints for rollbacks if necessary. Once the plan is approved we need to use /agent-skills:build to actually execute the work and finally /agent-skills:test to ensure we have coverage. In addition be sure to always check .claude/knowledge for accurate docs coverage for all changes made. The README.md if impacted, etc. Be thorough. Unless otherwise stated assume that priority is to reduce tech debt. This machine is the only user. No focus should be spent on backwards compatibility or shims. Keep things clean and clear.

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time. If a question can be answered by exploring the codebase, explore the codebase instead.

$ARGUMENTS