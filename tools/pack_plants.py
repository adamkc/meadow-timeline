#!/usr/bin/env python3
"""Pack the baked grass, flower and forb cards (tools/bake.sh) into one atlas.

  data/plants.webp   a grid of square cells, one plant picture each, with the
                     plant's own shading (sky visibility) multiplied in
  data/plants.json   per cell: kind, real width and height in metres, average colour

Kinds: lush and dry meadow grass (scans), and plants built from scratch:
sedge, rush, corn lily and a set of Sierra Nevada wildflowers and understory
plants.

  /usr/bin/python3 tools/pack_plants.py
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

BAKE = os.path.expanduser("~/.cache/meadow_render/bake")
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
CELL, GRID = 512, 6
# bake name, kind, size multiplier, which of its plants to use as (plant, view)
SOURCES = [
    ("plant_grass_lush", "lush", 1.0, [(0, 0), (2, 0), (1, 0)]),
    ("plant_grass_dry", "dry", 1.0, [(0, 0), (1, 0), (1, 1)]),
    # Everything below is built from scratch (tools/proc_plants.js), not scanned.
    ("plant_sedge", "sedge", 0.75, [(0, 0), (1, 0), (2, 0)]),
    ("plant_rush", "rush", 0.8, [(0, 0), (1, 0)]),
    ("plant_cornlily", "lily", 1.0, [(0, 0), (1, 1), (3, 0), (2, 0)]),   # three leafy stems and one in flower
    # Sierra Nevada wildflowers, in the order of the species table in src/grass.js.
    ("plant_camas", "camas", 1.0, [(0, 0), (1, 0)]),
    ("plant_shootingstar", "shootingstar", 1.0, [(1, 0), (2, 0)]),
    ("plant_bistort", "bistort", 1.0, [(0, 0), (1, 0)]),
    ("plant_elephantshead", "elephantshead", 1.0, [(0, 0), (2, 0)]),
    ("plant_sneezeweed", "sneezeweed", 1.0, [(0, 0), (1, 0)]),
    ("plant_lupine", "lupine", 1.0, [(0, 0), (1, 0)]),
    ("plant_yarrow", "yarrow", 1.0, [(0, 0), (1, 0)]),
    ("plant_mulesears", "mulesears", 1.0, [(0, 0), (1, 0)]),
    ("plant_paintbrush", "paintbrush", 1.0, [(0, 0)]),
    ("plant_bracken", "bracken", 1.0, [(0, 0), (1, 0), (2, 0)]),
    ("plant_snowplant", "snowplant", 1.0, [(0, 0)]),
]

cells, index = [], []
for name, kind, scale, picked in SOURCES:
    roots = json.load(open(f"{BAKE}/{name}.json"))
    for i, v in picked:
        t = roots[i]
        w, h = t["width"], t["height"]
        nviews = round(w / h * t["frameH"] / t["frameW"])
        cw = w // nviews
        a = np.fromfile(f"{BAKE}/{name}_{i}_A.rgba", "u1").reshape(h, w, 4)[::-1, v * cw:(v + 1) * cw].astype("f4") / 255
        b = np.fromfile(f"{BAKE}/{name}_{i}_B.rgba", "u1").reshape(h, w, 4)[::-1, v * cw:(v + 1) * cw].astype("f4") / 255
        cov = a[..., 3]
        ys, xs = np.nonzero(cov > 0.03)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        ground = int(round((t["y0"] + t["frameH"]) / t["frameH"] * h))    # the row at ground level
        y1 = min(h, max(y1, ground))                                       # cells always reach down to the ground
        rgb = a[..., :3] * (0.5 + 0.5 * b[..., 3:4])                       # darker deep inside the plant
        pre = np.dstack([rgb * cov[..., None], cov])[y0:y1, x0:x1]
        # Bilinear, not a sharper filter: ringing would leave bright garbage at the edges of thin blades.
        small = np.dstack([np.array(Image.fromarray(pre[..., k]).resize((CELL, CELL), Image.BILINEAR)) for k in range(4)])
        alpha = np.clip(small[..., 3], 0, 1)
        colour = np.clip(small[..., :3] / np.maximum(alpha[..., None], 1e-4), 0, 1)
        solid = alpha > 0.5
        # Thinly covered and empty texels take the colour of the nearest well-covered
        # one, so that small mipmaps average plant colour, not noise.
        idx = ndi.distance_transform_edt(alpha < 0.3, return_distances=False, return_indices=True)
        colour = colour[idx[0], idx[1]]
        linear = np.where(colour <= 0.04045, colour / 12.92, ((colour + 0.055) / 1.055) ** 2.4)
        cells.append(np.dstack([colour, alpha]))
        index.append({
            "name": f"{t['name']}_{v}", "kind": kind,
            "width": round((x1 - x0) / cw * t["frameW"] * scale, 3), "height": round((y1 - y0) / h * t["frameH"] * scale, 3),
            # Average colour of the upper part: in a meadow the dark bases are hidden
            # behind other plants, so this is the colour the eye gets.
            "mean": [round(float(c), 4) for c in linear[:int(CELL * 0.6)][solid[:int(CELL * 0.6)]].mean(axis=0)],
            "cover": round(float(solid.mean()), 3),
        })
        print(f"{index[-1]['name']:32s} {kind:7s} {index[-1]['width']:.2f} x {index[-1]['height']:.2f} m  cover {index[-1]['cover']:.2f}  mean {index[-1]['mean']}")

assert len(cells) <= GRID * GRID
cells += [np.zeros((CELL, CELL, 4), "f4")] * (GRID * GRID - len(cells))
atlas = np.vstack([np.hstack(cells[r * GRID:(r + 1) * GRID]) for r in range(GRID)])
Image.fromarray(np.clip(np.rint(atlas * 255), 0, 255).astype("u1"), "RGBA").save(f"{OUT}/plants.webp", quality=84, alpha_quality=90, method=6, exact=True)
kinds = {}
for i, p in enumerate(index):
    kinds.setdefault(p["kind"], [i, 0])[1] += 1   # first picture and how many, per kind
json.dump({"grid": GRID, "cell": CELL, "plants": index, "kinds": kinds,
           "source": "Poly Haven (CC0): grass_medium_01, grass_medium_02; all others built in tools/proc_plants.js"},
          open(f"{OUT}/plants.json", "w"), indent=1)
print(f"plants.webp: {atlas.shape[1]}x{atlas.shape[0]}, {os.path.getsize(f'{OUT}/plants.webp') / 1e6:.2f} MB")
