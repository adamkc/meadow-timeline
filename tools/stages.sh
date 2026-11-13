#!/bin/bash
# One view at every stage of the timeline, as a contact sheet.
# Usage: tools/stages.sh <name> "<query without stage>"   e.g. tools/stages.sh air "u=0.5&height=150&pitch=-25"
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HERE/../shots/tmp}"
args=()
for s in 0 1 2 3 4 5 6; do args+=("$1_$s=$2&stage=$s"); done
OUT="$OUT" "$HERE/shot.sh" "${args[@]}" 2>&1 | grep -v 404 | grep -iE "error|warn|pageerror" | cut -c1-400 || true
/usr/bin/python3 - "$OUT" "$1" <<'PY'
import sys
from PIL import Image
out, name = sys.argv[1], sys.argv[2]
tiles = [Image.open(f"{out}/{name}_{s}.png").convert("RGB").resize((800, 450)) for s in range(7)]
sheet = Image.new("RGB", (1600, 1800), (20, 20, 20))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % 2) * 800, (i // 2) * 450))
sheet.save(f"{out}/{name}_sheet.png")
PY
