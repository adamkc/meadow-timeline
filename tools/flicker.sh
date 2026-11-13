#!/bin/bash
# WSL wrapper for flicker.mjs: frames land in $OUT/<name>/ (default shots/tmp/flicker).
# Usage: tools/flicker.sh <name> "<query>" [positions] [frames] [move|wind|both]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
WIN=/mnt/c/Users/$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')/AppData/Local/Temp/meadow_tools
OUT="${OUT:-$HERE/../shots/tmp/flicker}"
mkdir -p "$OUT/$1" "$WIN/out/flicker"
cp "$HERE/flicker.mjs" "$WIN/flicker.mjs"
(cd "$WIN" && SHOT_DIR=out/flicker WSLENV=SHOT_DIR:SHOT_SIZE:SHOT_URL:SHOT_GPU:PERIOD:FPS:STAGE_FROM:STAGE_RATE "/mnt/c/Program Files/nodejs/node.exe" flicker.mjs "$@")
cp "$WIN/out/flicker/$1/"*.png "$OUT/$1/"
