# OpenCode Context Injector

Project-file based context injection for **OpenCode V2**. Tested against OpenCode
and the plugin API **2.1.4**. Version 0.2.0 no longer supports the V1 plugin API.

**Migration status: incomplete.** V1 automatically excluded slash commands from
both injection chains. That behavior is not yet preserved in this V2 port. The
explicit bypass below is not an equivalent replacement, and passing hook and
plugin-loading tests does not establish full V1 behavior parity. Do not release
this migration as complete until automatic command exclusion is restored and
tested through actual command execution.

## Features

- Adds `.opencode/inject-user.md` to the structured system prompt for normal
  requests, without rewriting visible user text.
- Queues `.opencode/inject-idle.md` once after a successful normal turn.
- Replaces `{{CURRENT_DATE}}` with the current UTC date at injection time.
- `? ` at the beginning bypasses both chains and is removed from the prompt.
- Synthetic inputs and OpenCode `!` shell messages receive neither injection.
- Model shell-tool calls suppress the idle follow-up, but keep user guidance
  during the normal task.
- Missing or empty files disable the corresponding behavior. There is no
  artificial character or token limit.
- Installs the global `/setup-inject-context` command to copy or restore the
  original project templates, preserving customizations unless `--force` is used.
- No runtime dependencies or build step; the installed plugin is one JS file.

The Markdown files are fully user-editable instructions, not hard-coded policy.
Keep secrets and large documentation copies out of them.

## V2 Technical Flow

The default export has a stable `id` and `setup(ctx)`. It registers the V2
`session.prompt`, `session.context`, and `tool.execute.before` hooks and consumes
the public event stream. It does not return V1 hook objects.

1. **Admission:** the prompt hook removes `? ` and persists its bypass decision
   in message metadata. Attachment mention offsets are updated when text shifts.
2. **Model context:** the context hook reads the latest delivered user,
   synthetic, or shell input. Pending prompts cannot change the bypass decision
   for the active turn. User instructions become `{ type: "text", text }` system
  parts, including on tool-driven continuations; duplicate parts are avoided.
   A running instance retains the verified turn decision across compaction. If
   a reload leaves no original input in the active context, it conservatively
   skips injection rather than guessing the lost bypass state.
3. **Idle:** `session.status` events with `data.status.type === "idle"` trigger a
   follow-up only for a tracked, successfully completed normal turn. Failed,
   interrupted, bypassed, synthetic, and shell turns do not start follow-ups.
4. **Follow-up admission:** `ctx.session.synthetic` admits a synthetic input
   using `delivery: "queue"`, so it does not steer or interrupt newer work.
   Its ID is derived from the originating input. Repeated idle events cannot
   start a loop; failed admission can retry with the same ID.
5. **Lifecycle:** events from other locations are ignored. Deleted, archived,
   and moved sessions release their state. Unloading aborts the event stream,
   cancels reconnect timers, and clears file and session caches.

Files are resolved from `ctx.location.directory` first, then
`ctx.location.project.directory`. Non-empty local files override root files.
Contents are cached by modification time, change time, and size; each injection
checks for edits and expands the date again.

### Slash Commands: V2 Migration Boundary

V2 has **no global `command.execute.before` hook**. A command that submits a
normal prompt without origin metadata is indistinguishable from user input.
Unlike V1, arbitrary slash commands therefore cannot be automatically excluded.
Command authors can explicitly bypass both chains:

```js
await ctx.session.prompt({
  sessionID,
  text: commandText,
  metadata: { injectContextBypass: true },
})
```

For ordinary user prompts, use `? ` as before. This prefix applies to the text
received by the prompt hook, not necessarily to a slash command's arguments:
templates may insert other text before those arguments. Client-only commands
that submit no model prompt do not trigger injection.

## Install From GitHub

```bash
git clone https://github.com/nobiehl/opencode-context-injector.git
cd opencode-context-injector
./install.sh /path/to/project
```

On Windows, run PowerShell from the repository:

```powershell
.\install.ps1 -ProjectPath C:\path\to\project
```

The installer copies the plugin to:

```text
~/.config/opencode/plugins/opencode-context-injector.js
```

On Windows this is normally
`C:\Users\<user>\.config\opencode\plugins\opencode-context-injector.js`.
Both installers respect `XDG_CONFIG_HOME`; `OPENCODE_CONFIG_DIR` overrides it.
The Unix installer also
supports `OPENCODE_PLUGIN_DIR` to override the plugin directory independently.

The installer preserves existing project instruction files and the global
`commands/setup-inject-context.md` command. It warns about legacy `inject-user.js`,
`inject-idle.js`, or a project-local setup command. Disable duplicate plugins;
do not install the same plugin through both auto-discovery and configuration.

OpenCode V2 reloads watched plugins automatically. Use `/reload` to force a
reload, then confirm the plugin ID with `opencode plugin list`.

### Load a Checkout Directly

Configured local plugin paths must be **directories**, not JS filenames. Add
the checkout to the applicable `opencode.json(c)` instead of copying the file:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["C:/path/to/opencode-context-injector"]
}
```

The checkout loads through its `index.js` default export. The installer remains
useful for bootstrapping project templates. Package publishing is not yet enabled.

## Project Guidance

`/setup-inject-context` copies the original templates; it does not analyze your
project. Edit `.opencode/inject-user.md` and `.opencode/inject-idle.md` directly.
Without `--force`, existing files are preserved; `--force` restores both originals.

- **Normal requests:** research only when needed, inspect relevant code, verify
  current facts, state uncertainty, and answer directly.
- **Idle follow-up:** treat the task as complete; check only for durable insights,
  decisions, or operational changes. Update existing documentation only when
  warranted. Do not start a new task or record trivial actions.

See [`docs/context-budget.md`](docs/context-budget.md) for context guidance.

## Diagnostics

Logging is off by default. Enable `OPENCODE_CONTEXT_INJECTOR_DEBUG=1` in the
**server's environment**, or configure `{ "package": "/path/to/checkout",
"options": { "debug": true } }`. In shared-service mode, changing a variable only
in a new client terminal does not change the already running server environment.

The plugin uses V2 console logging, not the removed V1 `client.app.log` API. Debug
entries include hook names, session IDs, and character counts, never instruction
contents. File, admission, and subscription failures emit concise warnings.

## Development and Verification

Use Node.js 22 or newer:

```bash
npm ci
npm run check
npm test
```

`npm run check` validates the JS implementation against the released V2 plugin
types. Runtime installation does not need these development dependencies.
Tests cover hooks, queue-aware bypasses, one-shot idle admission, cleanup,
location isolation, shell suppression, file updates, and installer preservation.

Opt into the isolated real-OpenCode loading test when `opencode` is on `PATH`:

```powershell
$env:OPENCODE_SMOKE = "1"
npm test
```

The smoke test uses `opencode serve --stdio` with a private authenticated server
and temporary config/data directories. It
makes no model requests and does not modify your real OpenCode installation.
Cross-platform CI and protected live-provider testing remain planned in
[`docs/ci-testing-plan.md`](docs/ci-testing-plan.md).

## License

MIT
