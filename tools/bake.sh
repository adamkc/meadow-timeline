#!/bin/bash
# WSL wrapper for bake.mjs (Windows Node + Chrome). Raw outputs land in the
# asset cache under bake/. Usage: [BAKE_NAME=<output name>] [BAKE_QUERY='&...'] tools/bake.sh <asset> [alpha map file]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
WIN=/mnt/c/Users/$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')/AppData/Local/Temp/meadow_tools
OUT="$HOME/.cache/meadow_render/bake"
mkdir -p "$OUT" "$WIN/bake"
cp "$HERE/bake.mjs" "$WIN/bake.mjs"
(cd "$WIN" && BAKE_DIR=bake WSLENV=BAKE_DIR:BAKE_QUERY:BAKE_NAME:SHOT_URL "/mnt/c/Program Files/nodejs/node.exe" bake.mjs "$@")
mv "$WIN/bake/${BAKE_NAME:-$1}"* "$OUT/"
