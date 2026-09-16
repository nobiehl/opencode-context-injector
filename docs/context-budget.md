# Context Budget

The injector adds `inject-user.md` to the system prompt for normal requests and
sends `inject-idle.md` as a synthetic prompt after idle events. The content is
fully project-controlled, so its context cost depends on each file.

## Decision

- Keep the two files semantically aligned. Repository templates provide the
  general baseline; generated local files may add verified project guidance and
  do not need to match the templates byte-for-byte.
- Put durable project policy in project documentation, not in every prompt.
- Keep only behavior that must be applied to the current prompt in the
  injection files.

There is no plugin-enforced token or character budget. Keep the files relevant
to their injection point so project context remains useful.

## Customization Boundary

The Markdown files contain user-editable prompt instructions. Their wording
is not enforced by the plugin. Users can replace or empty them for each
project.

The plugin enforces only the injection mechanics: file lookup, date expansion,
system-prompt transformation, synthetic-message filtering, the `? ` bypass,
and the optional idle follow-up.

## Current Templates

The repository templates are the source of truth for the general rules for
research, verified answers, idle completion checks, documentation changes,
dashboard relevance, clear result summaries, and the final one-line poem. Local
project files may customize these rules with verified project facts.

The templates should provide useful project context without imposing an
arbitrary size budget. They must still avoid unsupported claims and secrets.
