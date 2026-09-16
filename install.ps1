param(
  [string]$ProjectPath = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configDir = if ($env:OPENCODE_CONFIG_DIR) {
  $env:OPENCODE_CONFIG_DIR
} else {
  Join-Path $HOME ".config\opencode"
}
$pluginDir = Join-Path $configDir "plugins"
$commandDir = Join-Path $configDir "commands"
$projectDir = (Resolve-Path -LiteralPath $ProjectPath).Path

New-Item -ItemType Directory -Force -Path $pluginDir, $commandDir, (Join-Path $projectDir ".opencode") | Out-Null

$legacyProjectCommand = Join-Path $projectDir ".opencode\commands\setup-inject-context.md"
if (Test-Path -LiteralPath $legacyProjectCommand) {
  Write-Warning "Legacy project-local setup command found: $legacyProjectCommand. The current command is installed globally; remove the old file."
}

foreach ($legacy in @("inject-user.js", "inject-idle.js")) {
  $legacyPath = Join-Path $pluginDir $legacy
  if (Test-Path -LiteralPath $legacyPath) {
    Write-Warning "Legacy plugin found: $legacyPath. Disable it before restarting to avoid duplicate injections."
  }
}

Copy-Item -Force "$scriptDir\index.js" (Join-Path $pluginDir "opencode-context-injector.js")

foreach ($template in @("inject-user.md", "inject-idle.md")) {
  $target = Join-Path $projectDir ".opencode\$template"
  if (Test-Path -LiteralPath $target) {
    Write-Host "Preserved: $target"
  } else {
    Copy-Item "$scriptDir\templates\$template" $target
    Write-Host "Created: $target"
  }
}

$commandTarget = Join-Path $commandDir "setup-inject-context.md"
if (Test-Path -LiteralPath $commandTarget) {
  Write-Host "Preserved: $commandTarget"
} else {
  Copy-Item "$scriptDir\templates\setup-inject-context.md" $commandTarget
  Write-Host "Created: $commandTarget"
}

Write-Host "Plugin installed: $(Join-Path $pluginDir 'opencode-context-injector.js')"
Write-Host "Project: $projectDir"
Write-Host "Restart OpenCode after installation."
