#!/usr/bin/env python3
"""Pack the raw tree bakes (tools/bake.sh) into the two atlases the scene loads.

  data/cards_a.webp   colour, coverage in alpha
  data/cards_b.webp   normal x, y; sunlit fraction; sky visibility (in alpha)
  data/cards.json     layout and each tree's size

Each tree is a strip of eight views; strips are stacked in two columns. Run after baking:
  /usr/bin/python3 tools/pack_cards.py
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

BAKE = os.path.expanduser("~/.cache/meadow_render/bake")
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
# bake name, kind, which of its trees to use (None = all). Snags are the same
# trees baked without needles (BAKE_NAME=<asset>_snag, &snag=1).
ASSETS = [("fir_tree_01", "fir", None), ("pine_tree_01", "pine", None), ("fir_sapling_medium", "sapling", None),
          ("pine_sapling_medium", "pinesapling", None),
          ("pine_tree_01_snag", "snag", [0]), ("pine_sapling_medium_snag", "snag", [0, 2]), ("fir_sapling_medium_snag", "snag", [0]),
          # Built in tools/proc_plants.js, not scanned. Keep these last: the near-tree meshes cover only the scans before them.
          ("willow", "willow", None), ("willow_snag", "deadwillow", None)]
COLUMNS = 2    # trees are laid out down each column in turn
CELL_H = 512   # stored height of a cell; with 20 trees the atlas is 4096 x 5120
SHRINK = 2  # the bake is rendered at twice the stored size
VIEWS = 8   # must match tools/bake_cards.html

rows_a, rows_b, trees = [], [], []
def squash(a, height):
    """Resize rows to `height` (area average)."""
    return np.dstack([np.array(Image.fromarray(a[..., k].astype("f4")).resize((a.shape[1], height), Image.BOX)) for k in range(a.shape[2])])


for asset, kind, which in ASSETS:
    for i, t in enumerate(json.load(open(f"{BAKE}/{asset}.json"))):
        if which is not None and i not in which:
            continue
        w, h = t["width"], t["height"]
        a = np.fromfile(f"{BAKE}/{asset}_{i}_A.rgba", "u1").reshape(h, w, 4)[::-1].astype("f4")
        b = np.fromfile(f"{BAKE}/{asset}_{i}_B.rgba", "u1").reshape(h, w, 4)[::-1].astype("f4")
        # Average blocks weighted by coverage, so empty texels don't darken edges.
        cov = a[..., 3:4] / 255.0
        box = lambda x: x.reshape(h // SHRINK, SHRINK, w // SHRINK, SHRINK, -1).mean(axis=(1, 3))
        cov_s = squash(box(cov), CELL_H)
        safe = np.maximum(cov_s, 1e-6)
        rgb = squash(box(a[..., :3] * cov), CELL_H) / safe
        rest = squash(box(b * cov), CELL_H) / safe
        # Spread colour and shading outward into empty texels: filtering and
        # mipmaps then blend with something sensible instead of black.
        empty = cov_s[..., 0] < 0.02
        idx = ndi.distance_transform_edt(empty, return_distances=False, return_indices=True)
        rgb, rest = rgb[idx[0], idx[1]], rest[idx[0], idx[1]]
        # The part of the cell the tree actually occupies, over all views, as
        # fractions: left, right, bottom, top. Cards are trimmed to it.
        cell_w = cov_s.shape[1] // VIEWS
        seen = (cov_s[..., 0] > 0.02).reshape(cov_s.shape[0], VIEWS, cell_w).any(axis=1)
        xs, ys = np.where(seen.any(axis=0))[0], np.where(seen.any(axis=1))[0]
        bounds = [max(0.0, (xs[0] - 1) / cell_w), min(1.0, (xs[-1] + 2) / cell_w),
                  max(0.0, 1 - (ys[-1] + 2) / cov_s.shape[0]), min(1.0, 1 - (ys[0] - 1) / cov_s.shape[0])]
        rows_a.append(np.dstack([rgb, cov_s * 255.0]))
        rows_b.append(rest)
        trees.append({
            "name": t["name"], "kind": kind,
            "height": round(t["top"], 3),                 # metres from the ground to the tip
            "frameWidth": round(t["frameW"], 3),          # metres covered by one cell
            "frameHeight": round(t["frameH"], 3),
            "frameBottom": round(t["y0"], 3),             # height of the cell's bottom edge
            "bounds": [round(v, 4) for v in bounds],
        })
        print(f"{t['name']:28s} {kind:8s} {t['top']:5.1f} m  coverage {100 * (cov_s > 0.5).mean():4.1f}%")

ROWS = -(-len(trees) // COLUMNS)


def layout(cells):
    blank = np.zeros_like(cells[0])
    cells = cells + [blank] * (ROWS * COLUMNS - len(cells))
    return np.clip(np.rint(np.hstack([np.vstack(cells[c * ROWS:(c + 1) * ROWS]) for c in range(COLUMNS)])), 0, 255).astype("u1")


atlas_a, atlas_b = layout(rows_a), layout(rows_b)
# Normals and shading vary slowly; half the size is plenty and saves memory.
atlas_b = np.array(Image.fromarray(atlas_b, "RGBA").resize((atlas_b.shape[1] // 2, atlas_b.shape[0] // 2), Image.BOX))
Image.fromarray(atlas_a, "RGBA").save(f"{OUT}/cards_a.webp", quality=80, alpha_quality=85, method=6, exact=True)
Image.fromarray(atlas_b, "RGBA").save(f"{OUT}/cards_b.webp", quality=76, alpha_quality=80, method=6, exact=True)
views = VIEWS
json.dump({"views": views, "columns": COLUMNS, "rows": ROWS, "cell": [atlas_a.shape[1] // views // COLUMNS, atlas_a.shape[0] // ROWS],
           "trees": trees, "source": "Poly Haven (CC0): fir_tree_01, pine_tree_01, fir_sapling_medium, pine_sapling_medium; willow built in tools/proc_plants.js"},
          open(f"{OUT}/cards.json", "w"), indent=1)
for n, a in (("cards_a.webp", atlas_a), ("cards_b.webp", atlas_b)):
    print(f"{n}: {a.shape[1]}x{a.shape[0]}, {os.path.getsize(f'{OUT}/{n}') / 1e6:.2f} MB")
