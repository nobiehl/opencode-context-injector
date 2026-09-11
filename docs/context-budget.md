# Context Budget

The injector adds instruction text to the conversation, so repeated rules
consume context on every normal prompt and idle follow-up.

## Decision

- Keep `inject-user.md` below 600 characters.
- Keep `inject-idle.md` below 800 characters.
- Keep the two files semantically aligned. Their language may differ between
  the English repository templates and a local project.
- Put durable project policy in project documentation, not in every prompt.
- Keep only behavior that must be applied to the current prompt in the
  injection files.

The limits are maintenance targets. The plugin's hard maximum remains 4,000
characters per instruction file.

## Current Templates

The repository templates and the service project's `.opencode` files use the
same compact rules for research, verified answers, idle completion checks,
documentation changes, dashboard relevance, and the final one-line poem.

Changes to either template set must preserve these limits unless a measured
behavioral need justifies a larger budget.
