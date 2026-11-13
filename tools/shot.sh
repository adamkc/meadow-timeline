#!/bin/bash
# WSL wrapper: runs shot.mjs with Windows Node + Chrome, copies PNGs to $OUT (default shots/tmp).
# One-time setup: npm i puppeteer-core in %TEMP%\meadow_tools.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
WIN=/mnt/c/Users/$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')/AppData/Local/Temp/meadow_tools
OUT="${OUT:-$HERE/../shots/tmp}"
mkdir -p "$OUT" "$WIN/out"
cp "$HERE/shot.mjs" "$WIN/shot.mjs"
(cd "$WIN" && SHOT_DIR=out WSLENV=SHOT_DIR:SHOT_SIZE:SHOT_URL:SHOT_GPU "/mnt/c/Program Files/nodejs/node.exe" shot.mjs "$@")
for a in "$@"; do n="${a%%=*}"; cp "$WIN/out/$n.png" "$OUT/$n.png"; done
