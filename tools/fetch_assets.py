#!/usr/bin/env python3
"""Download Poly Haven (CC0) assets into a local cache, outside the repo.

  /usr/bin/python3 tools/fetch_assets.py model fir_tree_01 1k
  /usr/bin/python3 tools/fetch_assets.py texture forest_ground_04 1k diff nor_gl

Models are fetched as glTF with their .bin and textures. The cache is
~/.cache/meadow_render/polyhaven/<id>/; the bake tools read it through the
`raw` symlink in the project folder.
"""
import hashlib
import json
import os
import sys
import urllib.request

CACHE = os.path.expanduser("~/.cache/meadow_render/polyhaven")
AGENT = {"User-Agent": "meadow-render-dev"}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT)) as r:
        return json.load(r)


def fetch(url, path, md5=None, size=None):
    if os.path.exists(path) and (size is None or os.path.getsize(path) == size):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    digest = hashlib.md5()
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT)) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            digest.update(chunk)
    if md5 and digest.hexdigest() != md5:
        os.remove(tmp)
        raise SystemExit(f"checksum mismatch for {url}")
    os.replace(tmp, path)
    print(f"  {os.path.relpath(path, CACHE)}  {os.path.getsize(path) / 1e6:.1f} MB", flush=True)


kind, asset, res, *maps = sys.argv[1:]
files = get_json(f"https://api.polyhaven.com/files/{asset}")
out = os.path.join(CACHE, asset)
if kind == "model":
    entry = files["gltf"][res]["gltf"]
    fetch(entry["url"], os.path.join(out, f"{asset}.gltf"), entry.get("md5"), entry.get("size"))
    for rel, inc in entry.get("include", {}).items():
        target = os.path.normpath(os.path.join(out, rel))
        assert target.startswith(out + os.sep), rel  # stay inside the asset's folder
        fetch(inc["url"], target, inc.get("md5"), inc.get("size"))
else:
    for m in maps:
        keys = [k for k in files if k.lower() == m.lower()]
        if not keys:
            raise SystemExit(f"{asset} has no map '{m}'. Available: {', '.join(k for k in files if isinstance(files[k], dict))}")
        entry = files[keys[0]][res]
        fmt = "jpg" if "jpg" in entry else sorted(entry)[0]
        e = entry[fmt]
        fetch(e["url"], os.path.join(out, os.path.basename(e["url"])), e.get("md5"), e.get("size"))
print("done", asset)
