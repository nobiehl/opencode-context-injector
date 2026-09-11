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
- The Markdown files are user-editable prompt instructions, not hard-coded
  policy. Users can replace, customize, or empty them for each project.
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

Do not run the combined plugin together with separate `inject-user.js` or
`inject-idle.js` plugins. Disable those older plugins first to avoid duplicate
injections. The installer warns if it finds either legacy filename.

Restart OpenCode after installing or changing the plugin. Changes to the two
project Markdown files are loaded on the next matching event.

## Windows Installation

Run PowerShell from the cloned repository:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1 -ProjectPath C:\path\to\project
```

The installer uses `OPENCODE_CONFIG_DIR` when set. Otherwise it installs the
plugin under `%USERPROFILE%\.config\opencode\plugins`, which is OpenCode's
default configuration path on Windows.

## Local Development

OpenCode can also load `index.js` directly from a local plugin directory. The
package has no runtime dependencies.

## CI Testing Plan

The planned cross-platform CI design is documented in
[`docs/ci-testing-plan.md`](docs/ci-testing-plan.md). It covers Linux and
Windows installers, isolated OpenCode smoke checks, local plugin behavior
tests, and separately protected live provider checks.

## Context Budget

The compact instruction rules and their maintenance limits are documented in
[`docs/context-budget.md`](docs/context-budget.md).

## License

MIT
