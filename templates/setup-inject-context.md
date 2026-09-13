---
description: Scan the project and create concise context injection files
---

Set up project-specific OpenCode context injection files.

Arguments: $ARGUMENTS

## Inspect

1. Inspect the project before changing files. Read relevant project guidance,
   README files, package manifests, build files, and existing documentation.
   Use `AGENTS.md` only for OpenCode or agent behavior rules.
2. Exclude `.env*`, credentials, private keys, tokens, `.git`, dependency
   directories, build output, and other secret or generated content.
3. Build a private inventory of verified facts: project purpose, languages and
   frameworks, important directories, normal development commands, tests,
   deployment or operations guidance, and documentation conventions.

## Derive

Translate the inventory into actionable instructions. Do not copy a project
summary or large documentation blocks into the prompt files.

- `inject-user.md` contains only durable project guidance for normal prompts:
  where to look before changing code, project-specific conventions, required
  validation commands, and important operational boundaries.
- `inject-idle.md` contains only durable completion guidance: which project
  documentation or configuration must be updated after a lasting change, how
  to verify it, and whether an existing dashboard is relevant.
- Include a rule only when it changes how the agent should work in this
  project. Do not invent rules when the project provides no evidence.
- Preserve the general behavior of the existing templates: research current
  external facts when needed, inspect project code for code questions, do not
  guess, state uncertainty, use the current date to verify freshness, answer
  concisely, and report verified results.

## Write

1. Create `.opencode/inject-user.md` and `.opencode/inject-idle.md`.
2. If either target exists, preserve it unless `$ARGUMENTS` contains `--force`.
   Without `--force`, report the existing file and do not replace it.
3. Keep `inject-user.md` at approximately 500 tokens or fewer and
   `inject-idle.md` at approximately 700 tokens or fewer. Remove repetition
   before removing actionable project guidance.
4. Include `{{CURRENT_DATE}}` when a date is useful. Never hard-code today's
   date.

## Verify

After writing, inspect both files again. Check that they contain no secrets,
only verified project-specific guidance, the date placeholder where needed,
and no duplicated documentation. Report the sources inspected, files created
or preserved, estimated sizes, and any uncertainty.
