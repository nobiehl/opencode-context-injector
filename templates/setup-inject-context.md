---
description: Scan the project and create concise context injection files
---

Set up the project's OpenCode context injection files.

Arguments: $ARGUMENTS

1. Inspect the project before changing files. Read relevant project guidance,
   README files, package manifests, build files, and existing documentation.
   Use `AGENTS.md` only for OpenCode or agent behavior rules.
2. Do not read or copy secrets. Exclude `.env*`, credentials, private keys,
   tokens, `.git`, dependency directories, and build output.
3. Use only verified project facts. Do not invent project rules or repeat large
   documentation blocks.
4. Create `.opencode/inject-user.md` and `.opencode/inject-idle.md`.
5. If either target already exists, preserve it unless `$ARGUMENTS` contains
   `--force`. Without `--force`, report the existing file and do not replace
   it.
6. Keep `inject-user.md` at approximately 500 tokens or fewer and
   `inject-idle.md` at approximately 700 tokens or fewer. Keep both files
   concise and semantically aligned.
7. The user file may contain only durable project-specific guidance that helps
   answer normal prompts. The idle file may contain only durable completion,
   documentation, and dashboard checks relevant to this project.
8. Include the current date placeholder `{{CURRENT_DATE}}` when a date is
   useful. Do not hard-code today's date.
9. Verify both files after writing them. Report the inspected sources, files
   created or preserved, and any uncertainty.
