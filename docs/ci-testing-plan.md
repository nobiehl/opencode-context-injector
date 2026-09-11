# CI Testing Plan

Status: planning only. No workflow is enabled by this document.

## Goals

The future CI setup must verify that the package can be installed and loaded
on Linux and Windows, that both installers preserve existing project files, and
that the injector behavior remains isolated and predictable.

The CI must cover:

- Shell and PowerShell installer syntax.
- Plugin loading and package metadata.
- Project template creation and preservation.
- User injection, idle injection, and the `? ` bypass.
- OpenCode installation and non-interactive configuration checks.
- Optional live model execution with protected credentials.

## Test Tiers

### Tier 1: Pull Request Safe Checks

These checks run without provider credentials and are safe for pull requests,
including pull requests from forks.

- Validate `install.sh` with `bash -n` and `shellcheck`.
- Parse `install.ps1` with PowerShell on Windows.
- Validate `package.json` as JSON and verify the declared package files exist.
- Run a JavaScript syntax/import check for `index.js`.
- Run the installer against a temporary project directory.
- Assert that `.opencode/inject-user.md` and `.opencode/inject-idle.md` are
  created when absent.
- Assert that `.opencode/commands/setup-inject-context.md` is created when
  absent.
- Pre-create customized template files and assert that the installers preserve
  them byte-for-byte.
- Pre-create a customized `setup-inject-context.md` and assert that the
  installers preserve it byte-for-byte.
- Create legacy `inject-user.js` and `inject-idle.js` files and assert that the
  installer emits a warning instead of silently creating a duplicate setup.

### Tier 2: Plugin Behavior Tests

Use a small local harness with fake OpenCode hook inputs and a fake session
client. No external model call is needed.

- A normal user message receives the contents of `inject-user.md`.
- `{{CURRENT_DATE}}` is replaced with an ISO date at read time.
- Missing, empty, and overlong instruction files perform no injection.
- Synthetic parts are ignored by the user injection hook.
- A prompt beginning with `? ` is passed without user instructions and the
  prefix is removed.
- The same bypass prevents the idle follow-up prompt.
- A normal idle event loads `inject-idle.md` once.
- The synthetic idle prompt does not trigger another injection.
- Parallel idle events produce at most one follow-up prompt.
- A failed idle prompt clears state so a later idle event can retry.

### Tier 3: OpenCode Smoke Checks

Run on each supported operating system after installing a pinned OpenCode
version.

- Verify `opencode --version`.
- Install the plugin into the global OpenCode plugin directory.
- Run `opencode debug config`.
- Assert that `opencode-context-injector.js` is loaded exactly once.
- Assert that the project instruction files are present.
- Run a non-interactive `opencode run` only when a provider is configured for
  the smoke job.

The default pull-request workflow must stop at Tier 1 and Tier 2. Tier 3 is
optional for configuration validation and does not require a model provider.

### Tier 4: Live Model Checks

Live model checks verify the complete path through OpenCode and a provider.
They are intentionally gated because they consume tokens and expose a secret
to the runner.

- Run only on pushes to the protected default branch or by manual dispatch.
- Store the provider credential as a GitHub Actions repository or environment
  secret, never in the repository.
- Pass the secret through an environment variable only for the live-test step.
- Do not run live tests for fork-originated pull requests.
- Use a small, deterministic prompt and assert a stable marker in the result.
- Upload only sanitized logs and never upload the environment or full context.
- Apply a timeout and fail the job if the provider call does not complete.

## Operating-System Matrix

The workflow should use a matrix with at least:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]
runs-on: ${{ matrix.os }}
```

Linux checks can also run inside a container when container-specific behavior
must be tested. A Linux container does not replace the Windows job; Windows
behavior requires `windows-latest` or a dedicated Windows runner.

## OpenCode Installation

The workflow should pin the OpenCode version used by the smoke tests instead of
silently testing a moving `latest` version. The installation step must be
platform-specific but expose the same `opencode` command on both systems.

The configuration test must use a temporary configuration directory or an
isolated runner home. It must not modify a developer's real OpenCode
configuration. The test must also confirm that legacy standalone plugins are
not installed alongside the combined plugin.

## Workflow Security

- Use read-only default `GITHUB_TOKEN` permissions unless a job needs more.
- Pin third-party actions to reviewed major versions or commit SHAs.
- Never print secrets, complete environments, provider headers, or prompts that
  contain credentials.
- Keep live model jobs separate from untrusted pull-request jobs.
- Do not use a self-hosted runner for untrusted pull requests.
- Store test output as sanitized artifacts only when it helps diagnosis.

## Proposed Workflow Files

The later implementation should add separate workflow files or clearly
separated jobs:

- `ci-static.yml`: syntax, metadata, and package-file checks.
- `ci-installers.yml`: Linux and Windows installer tests.
- `ci-plugin.yml`: local hook harness tests.
- `ci-opencode-smoke.yml`: isolated OpenCode installation and configuration.
- `ci-live.yml`: manually dispatched or protected-branch live provider test.

Keeping live checks separate prevents credentials and provider failures from
affecting normal pull-request validation.

## Acceptance Criteria

The CI plan is complete when:

- Pull requests pass all credential-free checks on Linux and Windows.
- Both installers preserve existing project customizations.
- The `/setup-inject-context` command is installed and existing command files
  are preserved.
- The combined plugin is loaded exactly once.
- Normal prompts, idle follow-ups, synthetic parts, and `? ` bypasses have
  automated coverage.
- OpenCode smoke checks run in an isolated configuration directory.
- Live provider checks are protected by branch/event rules and secrets.
- Failures include enough sanitized output to diagnose the platform and step.
