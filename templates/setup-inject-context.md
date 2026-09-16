---
description: Install or restore the project context templates
---

Arguments: $ARGUMENTS

Copy the two original context templates into the current project:

- `.opencode/inject-user.md`
- `.opencode/inject-idle.md`

Do not inspect the project and do not make project-specific changes. These files
are starting points that the project user can edit directly.

Without `--force`, create only missing files and preserve existing files. With
`--force`, restore both files exactly to the original template content below.
Report which files were created, preserved, or restored.

Explain to the project user:

- `inject-user.md` applies to normal requests and should contain concise rules
  for research, code inspection, verification, uncertainty, and answer style.
- `inject-idle.md` applies after idle and should contain rules for durable
  documentation or configuration changes and a clear final summary.
- Do not put secrets, credentials, unsupported claims, or large project
  documentation copies into either file.

Original `inject-user.md`:

```markdown
-------------------------------------------------------------------------------
Current date: {{CURRENT_DATE}}

Research only when needed:
- external, version-dependent, or fast-changing facts
- source-code questions: inspect the relevant project code
- use the internet, documentation, codebase, or shell as needed
- use the date to verify information is current

Do not guess. State uncertainty clearly.

Answer briefly, directly, and in simple language. State verified facts only.
End with a one-line poem.

-------------------------------------------------------------------------------
```

Original `inject-idle.md`:

```markdown
Current date: {{CURRENT_DATE}}

The previous task is complete. Do not start a new task.

Check only:
- durable insight, decision, or operational/configuration change
- if yes, update and verify the appropriate existing project documentation
- if no, change nothing; do not document trivial actions
- use AGENTS.md only for OpenCode or agent behavior rules
- update dashboard documentation or configuration only when relevant

Research only when needed. Do not guess; state uncertainty clearly.

End with a clear summary of the result, changes, verification, and uncertainty.
Use verified facts only.
End with a one-line poem.
```
