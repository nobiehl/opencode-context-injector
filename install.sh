#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="${OPENCODE_PLUGIN_DIR:-$CONFIG_DIR/plugins}"
COMMAND_DIR="$CONFIG_DIR/commands"
PROJECT_DIR="${1:-$PWD}"

mkdir -p "$PLUGIN_DIR" "$COMMAND_DIR" "$PROJECT_DIR/.opencode"

legacy_project_command="$PROJECT_DIR/.opencode/commands/setup-inject-context.md"
if [[ -e "$legacy_project_command" ]]; then
  printf 'WARNUNG: altes projektlokales Setup-Command gefunden: %s\n' "$legacy_project_command" >&2
  printf 'Das aktuelle Command wird global installiert; die alte Datei bitte entfernen.\n' >&2
fi

for legacy in inject-user.js inject-idle.js; do
  if [[ -e "$PLUGIN_DIR/$legacy" ]]; then
    printf 'WARNUNG: altes Plugin aktiv: %s\n' "$PLUGIN_DIR/$legacy" >&2
    printf 'Vor dem Neustart deaktivieren, sonst laufen Injektionen doppelt.\n' >&2
  fi
done

install -m 644 "$SCRIPT_DIR/index.js" "$PLUGIN_DIR/opencode-context-injector.js"

for template in inject-user.md inject-idle.md; do
  target="$PROJECT_DIR/.opencode/$template"
  if [[ -e "$target" ]]; then
    printf 'beibehalten: %s\n' "$target"
  else
    install -m 644 "$SCRIPT_DIR/templates/$template" "$target"
    printf 'erstellt: %s\n' "$target"
  fi
done

command_target="$COMMAND_DIR/setup-inject-context.md"
if [[ -e "$command_target" ]]; then
  printf 'beibehalten: %s\n' "$command_target"
else
  install -m 644 "$SCRIPT_DIR/templates/setup-inject-context.md" "$command_target"
  printf 'erstellt: %s\n' "$command_target"
fi

printf 'Plugin installiert: %s\n' "$PLUGIN_DIR/opencode-context-injector.js"
printf 'Projekt: %s\n' "$PROJECT_DIR"
printf 'Danach OpenCode neu starten.\n'
