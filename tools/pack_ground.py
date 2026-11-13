#!/usr/bin/env python3
"""Convert the scanned ground textures (Poly Haven, CC0) for the scene.

Writes data/ground_<name>.webp and data/ground.json, which lists each
texture's real-world size and average colour. The scene mostly uses them as
detail: the texture divided by its average, multiplied into the scene's own
ground colours.

  /usr/bin/python3 tools/fetch_assets.py texture forrest_ground_03 1k diffuse   (etc.)
  /usr/bin/python3 tools/pack_ground.py
"""
import glob
import json
import os

import numpy as np
from PIL import Image

RAW = os.path.expanduser("~/.cache/meadow_render/polyhaven")
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
# name in the scene -> (Poly Haven id, metres covered by one repeat)
TEXTURES = {"litter": ("forrest_ground_03", 2.0), "rocks": ("river_small_rocks", 2.9), "dirt": ("dirt_floor", 2.07)}

index = {}
for name, (asset, size) in TEXTURES.items():
    src = glob.glob(f"{RAW}/{asset}/*diff*")[0]
    im = Image.open(src).convert("RGB")
    im.save(f"{OUT}/ground_{name}.webp", quality=84, method=6)
    srgb = np.array(im).astype("f8") / 255
    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    index[name] = {"file": f"ground_{name}.webp", "size": size, "mean": [round(float(v), 4) for v in linear.mean(axis=(0, 1))], "source": asset}
    print(f"{name:7s} {asset:20s} {os.path.getsize(f'{OUT}/ground_{name}.webp') / 1e6:.2f} MB  mean {index[name]['mean']}")
json.dump(index, open(f"{OUT}/ground.json", "w"), indent=1)
