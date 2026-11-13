#!/usr/bin/env python3
"""Build light, real-geometry versions of the scanned trees for close range.

The Poly Haven trees model every needle (4 to 7 million triangles each), far
too heavy to draw. For each tree this writes:
  wood    the real trunk and branch meshes (the trunk thinned by merging
          vertices on a 5 cm grid)
  sprigs  a few thousand flat cards, each showing a scanned sprig of needles,
          placed and turned to follow the real needles (which are grouped into
          30 cm cells; each cell's needle area sets how many sprigs it gets)
Both carry sunlight and sky visibility for this scene's sun, estimated by
marching through a grid of needle density.

Outputs data/near_trees.bin, near_trees.json, near_sprigs_*.webp, near_wood_*.webp.
Run after tools/fetch_assets.py and tools/pack_cards.py:
  /usr/bin/python3 tools/build_near_trees.py
"""
import hashlib
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy import sparse
from scipy.sparse.csgraph import connected_components

RAW = os.path.expanduser("~/.cache/meadow_render/polyhaven")
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
PREVIEW = os.environ.get("NEAR_PREVIEW")  # folder for debug pictures, optional

ASSETS = {
    # needle_uv: where single needles sit in the twig atlas (u min, v min).
    # needle_px: length of a needle in the sprig pictures, in atlas pixels at 1k.
    # needle_m: how long to draw that needle. The scans model oversized needles
    #   (about 12 cm on the fir) to save triangles; up close the sprig pictures
    #   are drawn nearer to life size, and there are more of them.
    # fill: share of the scan's needle area the sprig cards should cover.
    # tint: the same needle colour grade as the far cards (tools/bake.sh).
    # tilted: sprigs are not drawn upright in the atlas; find each one's axis.
    "fir_tree_01": dict(alpha="fir_tree_01_twig_alpha_1k.jpg", needle_uv=(0.125, 0.7), needle_px=27, needle_m=0.05, fill=0.55, tint=(0.86, 0.95, 0.9), cell=0.30),
    "pine_tree_01": dict(alpha="pine_tree_01_twig_alpha_1k.jpg", needle_uv=(0.6, 0.5), needle_px=75, needle_m=0.10, fill=0.6, tint=(0.74, 1.08, 0.78), cell=0.32, tilted=True),
    "fir_sapling_medium": dict(alpha="fir_sapling_medium_twigs_alpha_1k.jpg", needle_uv=(0.125, 0.7), needle_px=27, needle_m=0.045, fill=0.6, tint=(0.86, 0.95, 0.9), cell=0.26),
}
ASSETS["pine_sapling_medium"] = dict(ASSETS["pine_tree_01"], alpha="pine_sapling_medium_twig_alpha_1k.jpg", cell=0.28)
ORDER = ["fir_tree_01", "pine_tree_01", "fir_sapling_medium", "pine_sapling_medium"]  # must match tools/pack_cards.py
TRUNK_CELL = 0.05      # metres; trunk vertices closer than this are merged
GRID = 0.2             # metres; cell of the needle-density grid used for lighting
EXTINCTION = 0.35      # light lost per (m2 of needle per m3) per metre
POS_RANGE = 26.0       # metres; positions are stored as int16 over +-this

CT = {5120: "i1", 5121: "u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
meta = json.load(open(f"{OUT}/meta.json"))
SUN = np.array(meta["sun"]["dir"], "f8")
SUN /= np.linalg.norm(SUN)
rng = np.random.default_rng(11)


def accessor(g, folder, asset, i):
    a = g["accessors"][i]
    bv = g["bufferViews"][a["bufferView"]]
    n = NC[a["type"]]
    dt = np.dtype(CT[a["componentType"]])
    assert bv.get("byteStride") in (None, dt.itemsize * n), "interleaved buffers are not handled"
    m = np.memmap(f"{folder}/{asset}.bin", dtype=dt, mode="r", offset=bv.get("byteOffset", 0) + a.get("byteOffset", 0), shape=(a["count"] * n,))
    return np.array(m.reshape(-1, n) if n > 1 else m)


def find_sprigs(asset, cfg):
    """Cut the sprig pictures out of the twig atlas. Returns the RGBA atlas and,
    per sprig, its four corner UVs (base-left, base-right, tip-left, tip-right),
    its size in pixels and its opaque area in pixels."""
    folder = f"{RAW}/{asset}"
    diff_name = [f for f in os.listdir(f"{folder}/textures") if "twig" in f and "_diff_" in f][0]
    rgb = np.array(Image.open(f"{folder}/textures/{diff_name}").convert("RGB")).astype("f4")
    rgb = np.clip(rgb * np.array(cfg["tint"]), 0, 255)
    alpha = np.array(Image.open(f"{folder}/{cfg['alpha']}").convert("L")).astype("f4")
    S = alpha.shape[0]
    labels, n = ndi.label(alpha > 128)
    sprigs, kept = [], []
    for k, sl in enumerate(ndi.find_objects(labels), start=1):
        m = labels[sl] == k
        px = m.sum()
        h, w = m.shape
        col = rgb[sl][m].mean(axis=0)
        green = col[1] > col[0] * 1.03 and col[1] > col[2] * 1.1
        single_needles = sl[0].start / S > cfg["needle_uv"][1] and sl[1].start / S > cfg["needle_uv"][0] - 0.03
        if px < 1500 or px > 0.5 * w * h or min(w, h) < 45 or not green or single_needles:
            continue  # bark, cones, bare twigs, single needles
        ys, xs = np.nonzero(m)
        pts = np.column_stack([xs + sl[1].start, ys + sl[0].start]).astype("f8")
        c = pts.mean(axis=0)
        ev, evec = np.linalg.eigh(np.cov((pts - c).T))
        a = evec[:, 1] if cfg.get("tilted") else np.array([0.0, -1.0])   # base to tip
        if abs(a[1]) > abs(a[0]):
            a = a if a[1] < 0 else -a                  # mostly vertical: tip is up in the picture
        else:
            a = a if a[0] > 0 else -a                  # mostly horizontal: tip is to the right
        b = np.array([-a[1], a[0]])
        b = b if b[0] > 0 else -b
        pa, pb = (pts - c) @ a, (pts - c) @ b
        a0, a1, b0, b1 = pa.min() - 3, pa.max() + 3, pb.min() - 3, pb.max() + 3
        corner = lambda al, be: ((c + a * al + b * be) / S).tolist()
        kept.append(k)
        sprigs.append(dict(uv=[corner(a0, b0), corner(a0, b1), corner(a1, b0), corner(a1, b1)],
                           length=a1 - a0, width=b1 - b0, base=-a0 / (a1 - a0), area=float(px)))
    assert sprigs, f"no sprigs found in {diff_name}"
    # The far cards are rendered from the single-needle strip of this atlas.
    # Bring the sprig pictures to the same average colour so near and far match.
    opaque = alpha > 128
    strip = opaque.copy()
    strip[: int(S * cfg["needle_uv"][1])] = False
    strip[:, : int(S * cfg["needle_uv"][0])] = False
    in_sprig = np.isin(labels, kept) & opaque
    rgb[in_sprig] = np.clip(rgb[in_sprig] * (rgb[strip].mean(axis=0) / rgb[in_sprig].mean(axis=0)), 0, 255)
    # Atlas: graded colour, spread into the transparent texels around each sprig.
    solid = alpha > 128
    idx = ndi.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    # Only the sprigs keep their coverage: a sprig's rectangle can overlap other
    # parts of the atlas (cones, bark), which would show as stray shards.
    rgba = np.dstack([rgb[idx[0], idx[1]], np.where(np.isin(labels, kept), alpha, 0)]).astype("u1")
    return rgba, sprigs


def merge_vertices(pos, nrm, uv, mask, tri, cell):
    """Thin a mesh by merging vertices that share a grid cell. Vertices on
    different texture islands (separate pieces of the original mesh) are kept
    apart so their texture coordinates are never averaged, but they share a
    position, so the surface stays closed."""
    key = np.floor(pos / cell).astype(np.int64)
    key -= key.min(axis=0)
    span = key.max(axis=0) + 1
    flat = (key[:, 0] * span[1] + key[:, 1]) * span[2] + key[:, 2]
    _, where = np.unique(flat, return_inverse=True)
    count = np.bincount(where).astype("f8")
    centre = np.column_stack([np.bincount(where, pos[:, k]) / count for k in range(3)])
    edges = sparse.coo_matrix((np.ones(len(tri) * 2), (np.r_[tri[:, 0], tri[:, 1]], np.r_[tri[:, 1], tri[:, 2]])), shape=(len(pos), len(pos)))
    islands, island = connected_components(edges, directed=False)
    combined = where.astype(np.int64) * islands + island
    _, first, vid = np.unique(combined, return_index=True, return_inverse=True)
    vcount = np.bincount(vid).astype("f8")
    new_pos = centre[where[first]]
    new_uv = np.column_stack([np.bincount(vid, uv[:, k]) / vcount for k in range(2)])
    new_mask = np.bincount(vid, mask) / vcount
    new_nrm = np.column_stack([np.bincount(vid, nrm[:, k]) for k in range(3)])
    new_nrm /= np.maximum(np.linalg.norm(new_nrm, axis=1, keepdims=True), 1e-9)
    t = vid[tri]
    t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])]
    t = t[np.unique(np.sort(t, axis=1), axis=0, return_index=True)[1]]
    return new_pos, new_nrm, new_uv, new_mask, t


class LightGrid:
    """Needle density on a grid, and from it how much sun and sky reach a point."""

    def __init__(self, centroids, areas):
        self.lo = centroids.min(axis=0) - 1.0
        shape = np.ceil((centroids.max(axis=0) + 1.0 - self.lo) / GRID).astype(int) + 1
        ijk = ((centroids - self.lo) / GRID).astype(int)
        flat = (ijk[:, 0] * shape[1] + ijk[:, 1]) * shape[2] + ijk[:, 2]
        dens = np.bincount(flat, areas, minlength=int(np.prod(shape))).reshape(shape) / GRID ** 3
        self.density = ndi.gaussian_filter(dens, 0.6)
        dirs = []
        for elev, n in [(12, 10), (35, 8), (62, 6), (85, 2)]:
            for i in range(n):
                az, e = (i + 0.37 * elev) / n * 2 * np.pi, np.radians(elev)
                dirs.append([np.sin(az) * np.cos(e), np.sin(e), np.cos(az) * np.cos(e)])
        self.sky_dirs = np.array(dirs)

    def _through(self, pts, d, start):
        """Needle area per m2 met along a ray from each point toward direction d."""
        total = np.zeros(len(pts))
        reach = np.linalg.norm(np.array(self.density.shape) * GRID)
        for s in np.arange(start, reach, GRID):
            q = (pts + d * s - self.lo) / GRID
            inside = ((q >= 0) & (q <= np.array(self.density.shape) - 1)).all(axis=1)
            if not inside.any():
                break
            total[inside] += ndi.map_coordinates(self.density, q[inside].T, order=1, mode="constant") * GRID
        return total

    def light(self, pts, start=0.15):
        sun = np.exp(-EXTINCTION * self._through(pts, SUN, start))
        sky = np.mean([np.exp(-EXTINCTION * self._through(pts, d, start)) for d in self.sky_dirs], axis=0)
        return sun, sky


def build_sprig_cards(centroids, areas, cell, sprigs, m_per_px, light, fill):
    """One or more sprig cards per cell of needles."""
    key = np.floor(centroids / cell).astype(np.int64)
    key -= key.min(axis=0)
    span = key.max(axis=0) + 1
    _, cid = np.unique((key[:, 0] * span[1] + key[:, 1]) * span[2] + key[:, 2], return_inverse=True)
    w = np.bincount(cid, areas)
    c = np.column_stack([np.bincount(cid, areas * centroids[:, k]) / w for k in range(3)])
    d = centroids - c[cid]
    cov = np.empty((len(w), 3, 3))
    for i in range(3):
        for j in range(i, 3):
            cov[:, i, j] = cov[:, j, i] = np.bincount(cid, areas * d[:, i] * d[:, j]) / w
    ev, evec = np.linalg.eigh(cov + np.eye(3) * 1e-8)
    e1, e2, e3 = evec[:, :, 2], evec[:, :, 1], evec[:, :, 0]   # long axis, across, thin axis
    outward = c * np.array([1, 0, 1]) + np.array([0, 0.3, 0])
    e1 = e1 * np.where((e1 * outward).sum(axis=1) < 0, -1, 1)[:, None]
    spread = np.sqrt(np.maximum(ev, 1e-8))                      # per axis, thin to long

    sprig_area = np.array([s["area"] for s in sprigs]) * m_per_px ** 2
    order = np.argsort(sprig_area)
    out = dict(pos=[], a=[], b=[], sprig=[], scale=[])
    for k in range(len(w)):
        want = fill * w[k] / np.median(sprig_area)              # sprigs' worth of needles in this cell
        n = int(want) + (rng.uniform() < want - int(want))
        if n == 0 and rng.uniform() < want * 2:
            n = 1
        for j in range(min(n, 7)):
            # Small cells get small sprigs; otherwise any of them.
            pick = order[rng.integers(0, max(1, int(np.ceil(len(order) * min(1.0, 0.35 + want)))))]
            roll = rng.normal(0, 0.35) + (np.pi / 2 if j % 2 else 0)   # alternate cards cross each other
            yaw = rng.normal(0, 0.3 if j < 2 else 0.6)
            a = e1[k] * np.cos(yaw) + e2[k] * np.sin(yaw)
            side = np.cross(a, e3[k])
            b = side * np.cos(roll) + e3[k] * np.sin(roll)
            b -= a * (a @ b)
            b /= np.linalg.norm(b)
            jitter = (rng.normal(0, 0.5, 3) * spread[k][::-1]) @ np.array([e1[k], e2[k], e3[k]]) if j else 0
            out["pos"].append(c[k] + jitter)
            out["a"].append(a)
            out["b"].append(b)
            out["sprig"].append(pick)
            out["scale"].append(rng.uniform(0.85, 1.25))
    out = {k: np.array(v) for k, v in out.items()}
    out["sun"], out["sky"] = light.light(out["pos"], start=0.1)
    return out


def q8(x):
    return np.clip(np.rint(x * 255), 0, 255).astype("u1")


def main():
    blob, index, textures, tex_id = bytearray(), [], [], {}

    def texture(path):
        digest = hashlib.md5(open(path, "rb").read()).hexdigest()
        if digest not in tex_id:
            tex_id[digest] = len(textures)
            name = f"near_wood_{len(textures)}.webp"
            Image.open(path).convert("RGB").save(f"{OUT}/{name}", quality=82, method=6)
            textures.append(name)
        return tex_id[digest]

    def append(arr):
        while len(blob) % 4:
            blob.append(0)
        start = len(blob)
        blob.extend(arr.tobytes())
        return start

    atlases = {}
    for asset in ORDER:
        cfg = ASSETS[asset]
        folder = f"{RAW}/{asset}"
        g = json.load(open(f"{folder}/{asset}.gltf"))
        rgba, sprigs = find_sprigs(asset, cfg)
        atlas_key = hashlib.md5(rgba.tobytes()).hexdigest()
        if atlas_key not in atlases:
            name = f"near_sprigs_{len(atlases)}.webp"
            Image.fromarray(rgba, "RGBA").save(f"{OUT}/{name}", quality=90, method=6, exact=True)
            atlases[atlas_key] = name
        if PREVIEW:
            shown = np.where(rgba[..., 3:] > 128, rgba[..., :3], 40).astype("u1")
            for s in sprigs:  # mark each sprig's base edge
                (x0, y0), (x1, y1) = (np.array(s["uv"][0]) * 1024).astype(int), (np.array(s["uv"][1]) * 1024).astype(int)
                for t in np.linspace(0, 1, 200):
                    shown[int(np.clip(y0 + (y1 - y0) * t, 0, 1023)), int(np.clip(x0 + (x1 - x0) * t, 0, 1023))] = (255, 0, 255)
            Image.fromarray(shown).save(f"{PREVIEW}/sprigs_{asset}.png")

        for node in g["nodes"]:
            if "mesh" not in node:
                continue
            wood = dict(pos=[], nrm=[], uv=[], mask=[], tex=[], tri=[])
            bark = 0
            needles = None
            nv = 0
            for p in g["meshes"][node["mesh"]]["primitives"]:
                mat = g["materials"][p["material"]]
                pos = accessor(g, folder, asset, p["attributes"]["POSITION"]).astype("f8")
                unwrapped = False
                if "TEXCOORD_0" in p["attributes"]:
                    uv = accessor(g, folder, asset, p["attributes"]["TEXCOORD_0"]).astype("f8")
                else:  # wrap the tiling bark around the stem
                    uv = np.column_stack([np.arctan2(pos[:, 2], pos[:, 0]) / np.pi, pos[:, 1] * 0.5])
                    unwrapped = True
                tri = accessor(g, folder, asset, p["indices"]).reshape(-1, 3).astype(np.int64)
                if "twig" in mat["name"]:
                    centre_uv = uv[tri].mean(axis=1)
                    is_needle = (centre_uv[:, 0] > cfg["needle_uv"][0]) & (centre_uv[:, 1] > cfg["needle_uv"][1])
                    t = tri[is_needle]
                    a, b, c = pos[t[:, 0]], pos[t[:, 1]], pos[t[:, 2]]
                    areas = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
                    needles = dict(c=(a + b + c) / 3, area=areas)
                    continue
                nrm = accessor(g, folder, asset, p["attributes"]["NORMAL"]).astype("f8")
                xf = mat["pbrMetallicRoughness"]["baseColorTexture"].get("extensions", {}).get("KHR_texture_transform")
                if xf:
                    uv = uv * np.array(xf.get("scale", [1, 1])) + np.array(xf.get("offset", [0, 0]))
                # The scans paint the trunk's base from a scanned texture and blend
                # into tiling bark above it, by a mask stored as a vertex colour.
                # The file keeps no texture coordinates for the tiling part, so
                # the mask is passed on and the scene projects the bark itself.
                mask = np.zeros(len(pos))
                if "trunk" in mat["name"]:
                    if unwrapped:
                        mask[:] = 1
                    elif "COLOR_1" in p["attributes"]:
                        mask = accessor(g, folder, asset, p["attributes"]["COLOR_1"])[:, 0] / 65535.0
                    pos, nrm, uv, mask, tri = merge_vertices(pos, nrm, uv, mask, tri, TRUNK_CELL)
                if unwrapped:  # triangles across the wrap get their own copies of the vertices on the far side
                    across = np.ptp(uv[tri][..., 0], axis=1) > 1
                    low = across[:, None] & (uv[tri][..., 0] < 0)
                    copies, inverse = np.unique(tri[low], return_inverse=True)
                    tri[low] = len(pos) + inverse
                    pos, nrm, mask = np.vstack([pos, pos[copies]]), np.vstack([nrm, nrm[copies]]), np.r_[mask, mask[copies]]
                    uv = np.vstack([uv, uv[copies] + [2, 0]])
                image = g["images"][g["textures"][mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]]["source"]]["uri"]
                wood["pos"].append(pos); wood["nrm"].append(nrm); wood["uv"].append(uv); wood["mask"].append(mask)
                wood["tex"].append(np.full(len(pos), texture(f"{folder}/{image}"), "u1"))
                if "trunk" not in mat["name"] and "dead" not in mat["name"]:
                    bark = texture(f"{folder}/{image}")
                wood["tri"].append(tri + nv)
                nv += len(pos)
            wood = {k: np.concatenate(v) for k, v in wood.items()}
            assert nv < 65536, f"{node['name']}: {nv} wood vertices"

            light = LightGrid(needles["c"], needles["area"])
            m_per_px = cfg["needle_m"] / cfg["needle_px"]  # size of an atlas pixel in the sprig pictures
            cards = build_sprig_cards(needles["c"], needles["area"], cfg["cell"], sprigs, m_per_px, light, cfg["fill"])
            wsun, wsky = light.light(wood["pos"] + wood["nrm"] * 0.05)

            v = np.zeros(nv, dtype=[("pos", "<i2", 3), ("nrm", "i1", 3), ("sun", "u1"), ("uv", "<i2", 2), ("sky", "u1"), ("tex", "u1"), ("mask", "u1"), ("pad", "u1")])
            v["pos"] = np.rint(wood["pos"] / POS_RANGE * 32767)
            v["nrm"] = np.rint(wood["nrm"] * 127)
            v["uv"] = np.clip(np.rint(wood["uv"] * 2048), -32767, 32767)
            v["sun"], v["sky"], v["tex"], v["mask"] = q8(wsun), q8(wsky), wood["tex"], q8(wood["mask"])
            c = np.zeros(len(cards["pos"]), dtype=[("pos", "<i2", 3), ("size", "<u2"), ("a", "i1", 3), ("sprig", "u1"), ("b", "i1", 3), ("sun", "u1"), ("sky", "u1"), ("pad", "u1", 3)])
            c["pos"] = np.rint(cards["pos"] / POS_RANGE * 32767)
            c["size"] = np.rint(cards["scale"] * 1000)
            c["a"], c["b"] = np.rint(cards["a"] * 127), np.rint(cards["b"] * 127)
            c["sprig"], c["sun"], c["sky"] = cards["sprig"], q8(cards["sun"]), q8(cards["sky"])
            entry = dict(name=node["name"], atlas=atlases[atlas_key], bark=bark, height=float(max(wood["pos"][:, 1].max(), needles["c"][:, 1].max())),
                         vertices=[append(v), nv], triangles=[append(wood["tri"].astype("<u2")), len(wood["tri"])],
                         cards=[append(c), len(c)],
                         sprigs=[dict(uv=s["uv"], length=s["length"] * m_per_px, width=s["width"] * m_per_px, base=s["base"]) for s in sprigs])
            index.append(entry)
            print(f"{node['name']:28s} wood {nv:6d} verts {len(wood['tri']):6d} tris | {len(c):5d} sprig cards from {len(needles['area']) / 1e6:.1f}M needle triangles, "
                  f"{needles['area'].sum():5.0f} m2 | sprigs {[round(s['length'] * m_per_px, 2) for s in sprigs]} m | "
                  f"sun {cards['sun'].mean():.2f} sky {cards['sky'].mean():.2f}", flush=True)

    # Snags: the same wood with no needles. Listed in the order of the card atlas.
    card_trees = [t for t in json.load(open(f"{OUT}/cards.json"))["trees"] if "willow" not in t["kind"]]  # willows are cards at any distance
    live = [t for t in card_trees if t["kind"] != "snag"]
    assert [t["name"] for t in live] == [e["name"] for e in index], "card atlas and near trees are out of step"
    for t in card_trees[len(live):]:
        source = next(e for e in index if e["name"] == t["name"])
        index.append(dict(source, cards=[0, 0], snag=True))

    open(f"{OUT}/near_trees.bin", "wb").write(blob)
    json.dump(dict(posRange=POS_RANGE, uvScale=2048, wood=textures, trees=index), open(f"{OUT}/near_trees.json", "w"))
    for name in ["near_trees.bin"] + textures + sorted(set(atlases.values())):
        print(f"{name:22s} {os.path.getsize(f'{OUT}/{name}') / 1e6:6.2f} MB")


if __name__ == "__main__":
    main()
