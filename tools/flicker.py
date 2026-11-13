"""Where the picture flickers.

Reads the runs written by tools/flicker.sh. Steady motion changes a pixel the
same way over a few consecutive frames; flicker reverses. For every three
consecutive frames this takes the smaller of the two changes where they have
opposite signs (zero otherwise), and averages that over the run: `flicker`.
`change` is the plain mean change between frames, mostly real motion.
"Pixels flickering visibly" is the share of pixels, per frame, whose reversal
is at least 6 of 255 levels: the number to watch.
Writes <name>_map.png (flicker, averaged over all positions, so anything fixed
on the screen stands out) and prints the numbers.
Usage: flicker.py <dir> <name> [<name> ...]
"""
import sys, glob, os
import numpy as np
from PIL import Image

root = sys.argv[1]
for name in sys.argv[2:]:
    runs = {}
    for f in sorted(glob.glob(f"{root}/{name}/p*_f*.png")):
        runs.setdefault(os.path.basename(f).split("_")[0], []).append(f)
    if not runs:
        print(f"{name:>14}: no frames")
        continue
    total, change, per, seen = None, [], [], []
    for key, files in runs.items():
        fr = [np.asarray(Image.open(f).convert("L"), dtype=np.float32) for f in files]
        d = [b - a for a, b in zip(fr, fr[1:])]
        rev = np.mean([np.where(a * b < 0, np.minimum(np.abs(a), np.abs(b)), 0) for a, b in zip(d, d[1:])], axis=0)
        change.append(np.mean([np.abs(x).mean() for x in d]))
        seen.append(np.mean([(np.where(a * b < 0, np.minimum(np.abs(a), np.abs(b)), 0) >= 6).mean() for a, b in zip(d, d[1:])]))
        per.append(rev.mean())
        total = rev if total is None else total + rev
        Image.fromarray(np.clip(rev * 25, 0, 255).astype(np.uint8)).save(f"{root}/{name}/flicker_{key}.png")
    mean = total / len(runs)
    Image.fromarray(np.clip(mean * 40, 0, 255).astype(np.uint8)).save(f"{root}/{name}_map.png")
    h = mean.shape[0]
    rows = [mean[i * h // 3:(i + 1) * h // 3].mean() for i in range(3)]
    print(f"{name:>14}: flicker {mean.mean():.3f} (top/mid/bottom {rows[0]:.2f} {rows[1]:.2f} {rows[2]:.2f})  "
          f"pixels flickering visibly {100 * np.mean(seen):.2f}%  change {np.mean(change):.2f}  per position {' '.join(f'{v:.2f}' for v in per)}")
