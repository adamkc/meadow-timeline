#!/usr/bin/env python3
"""Reduce the scanned logs (Poly Haven, CC0) for the scene.

Each model has about 100,000 triangles; vertices are merged on a grid of a few
centimetres to leave a couple of thousand. Writes data/logs.bin, logs.json and
data/log_<n>.webp. Run after tools/fetch_assets.py:
  /usr/bin/python3 tools/build_logs.py
"""
import json
import os

import numpy as np
from PIL import Image

from build_near_trees import OUT, RAW, accessor, merge_vertices

MODELS = [("dead_tree_trunk", 0.045), ("dead_tree_trunk_02", 0.075)]  # asset, grid cell in metres
POS_RANGE = 3.0  # metres; positions are stored as int16 over +-this

blob, index = bytearray(), []
for k, (asset, cell) in enumerate(MODELS):
    folder = f"{RAW}/{asset}"
    g = json.load(open(f"{folder}/{asset}.gltf"))
    p = g["meshes"][0]["primitives"][0]
    pos = accessor(g, folder, asset, p["attributes"]["POSITION"]).astype("f8")
    nrm = accessor(g, folder, asset, p["attributes"]["NORMAL"]).astype("f8")
    uv = accessor(g, folder, asset, p["attributes"]["TEXCOORD_0"]).astype("f8")
    tri = accessor(g, folder, asset, p["indices"]).reshape(-1, 3).astype(np.int64)
    full = len(tri)
    pos, nrm, uv, _, tri = merge_vertices(pos, nrm, uv, np.zeros(len(pos)), tri, cell)
    assert len(pos) < 65536 and np.abs(pos).max() < POS_RANGE
    # Lie along x through the origin, resting on y = 0.
    centre = (pos.min(axis=0) + pos.max(axis=0)) / 2
    pos -= [centre[0], np.percentile(pos[:, 1], 4), centre[2]]
    v = np.zeros(len(pos), dtype=[("pos", "<i2", 3), ("nrm", "i1", 3), ("pad", "u1"), ("uv", "<u2", 2)])
    v["pos"] = np.rint(pos / POS_RANGE * 32767)
    v["nrm"] = np.rint(nrm * 127)
    v["uv"] = np.clip(np.rint((uv % 1.0) * 65535), 0, 65535) if (uv.min() < 0 or uv.max() > 1) else np.rint(uv * 65535)
    image = g["images"][g["textures"][g["materials"][p["material"]]["pbrMetallicRoughness"]["baseColorTexture"]["index"]]["source"]]["uri"]
    Image.open(f"{folder}/{image}").convert("RGB").save(f"{OUT}/log_{k}.webp", quality=84, method=6)
    while len(blob) % 4:
        blob.append(0)
    v_at = len(blob); blob.extend(v.tobytes())
    while len(blob) % 4:
        blob.append(0)
    t_at = len(blob); blob.extend(tri.astype("<u2").tobytes())
    half = float(np.ptp(pos[:, 0]) / 2)
    index.append(dict(name=asset, texture=f"log_{k}.webp", vertices=[v_at, len(pos)], triangles=[t_at, len(tri)],
                      halfLength=round(half, 3), radius=round(float(np.percentile(np.hypot(pos[:, 1] - np.median(pos[:, 1]), pos[:, 2]), 60)), 3)))
    print(f"{asset:20s} {full} -> {len(tri)} triangles, {len(pos)} vertices, {2 * half:.2f} m long, radius about {index[-1]['radius']:.2f} m, "
          f"texture {os.path.getsize(f'{OUT}/log_{k}.webp') / 1e6:.2f} MB")
open(f"{OUT}/logs.bin", "wb").write(blob)
json.dump(dict(posRange=POS_RANGE, vertexBytes=v.dtype.itemsize, models=index), open(f"{OUT}/logs.json", "w"))
print(f"logs.bin {len(blob) / 1e6:.2f} MB")
