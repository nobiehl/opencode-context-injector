# Context Budget

The injector adds instruction text to the conversation, so repeated rules
consume context on every normal prompt and idle follow-up.

## Decision

- Target no more than approximately 500 tokens for `inject-user.md`.
- Target no more than approximately 700 tokens for `inject-idle.md`.
- Keep the two files semantically aligned. The repository templates are the
  source of truth; local project files must use their same content.
- Put durable project policy in project documentation, not in every prompt.
- Keep only behavior that must be applied to the current prompt in the
  injection files.

These token limits are maintenance targets. Exact counts depend on the model
tokenizer. The plugin's hard maximum remains 4,000 characters per instruction
file.

## Customization Boundary

The Markdown files contain user-editable prompt instructions. Their wording
is not enforced by the plugin. Users can replace or empty them for each
project.

The plugin enforces only the injection mechanics: file lookup, instruction
length, date expansion, synthetic-message filtering, the `? ` bypass, and the
optional idle follow-up.

## Current Templates

The repository templates are the source of truth for the compact rules for
research, verified answers, idle completion checks, documentation changes,
dashboard relevance, and the final one-line poem. Local project files must
match them.

Changes to either template set must preserve these limits unless a measured
behavioral need justifies a larger budget.
