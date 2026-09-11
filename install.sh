#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PLUGIN_DIR="${OPENCODE_PLUGIN_DIR:-$HOME/.config/opencode/plugins}"
PROJECT_DIR="${1:-$PWD}"

mkdir -p "$PLUGIN_DIR" "$PROJECT_DIR/.opencode"

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

printf 'Plugin installiert: %s\n' "$PLUGIN_DIR/opencode-context-injector.js"
printf 'Projekt: %s\n' "$PROJECT_DIR"
printf 'Danach OpenCode neu starten.\n'
