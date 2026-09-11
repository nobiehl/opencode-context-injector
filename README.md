# OpenCode Context Injector

Project-file based context injection for OpenCode.

## Features

- Appends `.opencode/inject-user.md` to normal user prompts.
- Runs `.opencode/inject-idle.md` once after a session becomes idle.
- Replaces `{{CURRENT_DATE}}` when an instruction file is read.
- Ignores synthetic idle messages to prevent cross-injection.
- `? ` at the beginning bypasses both injection chains and is removed before
  the prompt reaches the model.
- Empty or missing project files disable the corresponding behavior.
- Instruction files are limited to 4000 characters.

## Install From GitHub

Clone the repository and run the installer for a project:

```bash
git clone https://github.com/nobiehl/opencode-context-injector.git
cd opencode-context-injector
./install.sh /path/to/project
```

The installer copies the plugin to
`~/.config/opencode/plugins/opencode-context-injector.js` and creates the two
project templates only when they do not already exist. Existing project files
are preserved.

Restart OpenCode after installing or changing the plugin. Changes to the two
project Markdown files are loaded on the next matching event.

## Local Development

OpenCode can also load `index.js` directly from a local plugin directory. The
package has no runtime dependencies.

## License

MIT
