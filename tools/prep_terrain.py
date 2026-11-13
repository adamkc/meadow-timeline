#!/usr/bin/env python3
"""Turn ERASER rasters for one watershed into web assets for the meadow render.

The scene tells one story on real terrain, following the stream evolution
models (Schumm's channel evolution model; Cluer and Thorne's stage 0): a wet
meadow whose water spreads through many small channels; one channel captures
the flow and cuts a narrow trench; the trench widens; the meadow, now a terrace,
dries from its edges inward; conifers follow the drying front. Stages (the
scene's timeline runs 0..6 and blends between them):
  0 wet meadow, many channels    3 conifers move in     6 mature forest
  1 one channel cuts down        4 thickets
  2 the trench widens, drying    5 closed pole stand

What is measured and what is reconstructed:
  measured       the surveyed DEM (today's, incised terrain), the road-healed
                 DEM, flow accumulation, the road mask
  reconstructed  everything about the past and the plants. The pre-incision
                 surface is the surveyed one with its channels filled back to
                 the level of the flat ground beside them (the "terrace"),
                 wherever such ground exists within 4 m above the channel.
                 Meadow extent, wetness, tree positions and their timing are
                 rules of thumb, not data.

Two levels are written to data/: core (1 m, a square window) and far (4 m, the
whole DEM). Each gets
  *_h.bin, *_h_healed.bin   heights, uint16 centimetres above meta.zmin
  *_cut.png      R = depth of fill that restores the pre-incision surface
                 (0..4 m, over the healed heights), G = when the headcut
                 reaches this spot (0 at the downstream end .. 1 upstream),
                 B = distance from the channel's centre line (0..120 m)
  *_thread.png   the meadow's small channels before the capture: distance
                 inside a thread's edge (0.5 = the edge, +-4 m). Core only.
  *_bake.png     R = horizon angle toward the sun over bare ground (0..45 deg),
                 G = sky visibility, B = ground that stays wet after incision
                 (the inset floodplain beside the stream)
  *_aux.png      R = road, G = valid data, B = wet meadow before incision
  *_site.png     R = the order in which the meadow dries after incision: 0 at
                 its edges, 0.8 beside the channel; 1 = never (no incision),
                 G, B = sun horizon and sky visibility over the filled surface
  *_stage_lit.webp, *_stage_cover.webp
                 sunlight reaching the ground past the trees, and canopy cover,
                 at key stages (meta.stages.keys), stacked top to bottom
  *_water.png, *_water_healed.png
                 stream water for the surveyed and the road-healed terrain:
                 R = distance inside the water's edge (0.5 = the edge, +-4 m),
                 G, B = flow direction (east, south) scaled by speed

trees.bin holds every tree with its life: when it germinates, how tall it can
grow, when (if ever) it dies. log_places.bin holds downed logs and when each
appears. The scene, this script and the shaders share one growth rule (GROW_*).

Run with the system Python (needs numpy, scipy, Pillow and the gdal CLI):
  /usr/bin/python3 tools/prep_terrain.py
"""
import argparse
import json
import os
import subprocess
import tempfile
from collections import deque

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))

ap = argparse.ArgumentParser()
ap.add_argument("--site", default="NyeMeadow")
ap.add_argument("--col0", type=int, default=768, help="core window west edge (px)")
ap.add_argument("--row0", type=int, default=896, help="core window north edge (px)")
ap.add_argument("--size", type=int, default=1024, help="core window size (px = m)")
ap.add_argument("--sun-az", type=float, default=262.0, help="degrees clockwise from north")
ap.add_argument("--sun-alt", type=float, default=20.0, help="degrees above horizon")
ap.add_argument("--far-cell", type=int, default=4)
ap.add_argument("--tree-spacing", type=float, default=5.0, help="mean spacing of mature trees (m)")
ap.add_argument("--orbit", default="277,147", help="centre of the camera's circle (x,z in the core window, m); 'auto' picks one")
ap.add_argument("--path-via", default="300,585", help="a point on the tributary the flight comes down (x,z in the core window, m)")
args = ap.parse_args()

S = args.site
SRC = {
    "dem": f"{REPO}/RawData/new_watersheds/{S}_DEM.tif",
    "healed": f"{REPO}/Results/inpaint_geomorphic_8ch/{S}_DEM_corrected.tif",
    "acc": f"{REPO}/Results/roads_analysis/{S}/flow_accum.tif",
    "road": f"{REPO}/Results/roads_analysis/{S}/{S}_mask_binary.tif",
    "acc_healed": f"{REPO}/Results/roads_analysis/{S}/flow_accum_corrected.tif",
}
tmp = tempfile.mkdtemp(prefix="meadow_prep_")

# The timeline, in stage units.
STAGE_KEYS = [2, 3, 4, 5, 6]     # stages at which tree shade is baked (0..2 have no meadow trees yet)
CUT_START, CUT_SPAN = 0.35, 0.95  # the headcuts set off, and have worked their way up every reach this many stages later
HEADCUT_SPEED = 450.0            # metres of channel a headcut climbs per stage (faster on reaches too long to finish in time)
HEADCUT_FACE = 9.0               # metres of channel over which the bed drops at a headcut
CUT_TIME = HEADCUT_FACE / HEADCUT_SPEED  # so a spot cuts to full depth in this many stages
WIDEN_TIME, SLOT = 1.3, 2.2      # then the banks retreat for this long, from a slot this many metres either side of the centre line
DRY_SPAN, DRY_WIDTH = 1.8, 0.9   # the drying front takes DRY_SPAN stages to cross from the meadow's edge to the channel; a spot takes DRY_WIDTH to dry
GROW_SPAN, GROW_POW = 3.0, 1.3   # a tree reaches full height GROW_SPAN stages after it germinates
SWITCH_H = 9.5                   # below this a tree is drawn as a sapling, above as a mature tree


def tree_height(hmax, birth, death, stage):
    """Height of a tree at a stage (it stops growing when it dies)."""
    return hmax * np.clip((np.minimum(stage, death) - birth) / GROW_SPAN, 0, 1) ** GROW_POW


def read(path):
    """Read band 1 as float32 through the gdal CLI (the Python bindings crash here)."""
    info = json.loads(subprocess.check_output(["gdalinfo", "-json", path]))
    w, h = info["size"]
    raw = os.path.join(tmp, os.path.basename(path) + ".bin")
    subprocess.run(["gdal_translate", "-q", "-of", "ENVI", "-ot", "Float32", path, raw], check=True)
    return np.fromfile(raw, "<f4").reshape(h, w), info


def shifted(a, dy, dx, fill):
    """Array whose [r, c] holds a[r + dy, c + dx]; cells off the edge get `fill`."""
    out = np.full_like(a, fill)
    h, w = a.shape
    r0, r1 = max(0, -dy), min(h, h - dy)
    c0, c1 = max(0, -dx), min(w, w - dx)
    if r0 < r1 and c0 < c1:
        out[r0:r1, c0:c1] = a[r0 + dy:r1 + dy, c0 + dx:c1 + dx]
    return out


def horizon_tan(z, cell, az_deg, dists, surf=None):
    """Largest tan(elevation angle) from the ground `z` to the occluding surface
    (`surf`, default the ground itself) along one azimuth (>= 0)."""
    if surf is None:
        surf = z
    az = np.radians(az_deg)
    ux, uy = np.sin(az), -np.cos(az)  # per metre, in columns and rows
    best = np.zeros_like(z)
    seen = set()
    for d in dists:
        dx, dy = int(round(d * ux / cell)), int(round(d * uy / cell))
        if (dx, dy) == (0, 0) or (dx, dy) in seen:
            continue
        seen.add((dx, dy))
        rise = shifted(surf, dy, dx, -1e9) - z
        np.maximum(best, rise / (np.hypot(dx, dy) * cell), out=best)
    return best


def geometric(start, stop, factor):
    out, d = [], float(start)
    while d <= stop:
        out.append(d)
        d = max(d + 1, d * factor)
    return out


def sky_visibility(z, cell, dists):
    vis = np.zeros_like(z)
    for az in range(0, 360, 45):
        t = horizon_tan(z, cell, az, dists)
        vis += 1.0 - t / np.sqrt(1.0 + t * t)  # 1 - sin(horizon angle)
    return vis / 8.0


def to8(a):
    return np.clip(np.rint(a * 255.0), 0, 255).astype("u1")


def save_rgb(name, r, g, b):
    Image.fromarray(np.dstack([to8(r), to8(g), to8(b)])).save(os.path.join(OUT, name), optimize=True)


# ---- load --------------------------------------------------------------
dem, info = read(SRC["dem"])
H, W = dem.shape
valid = np.isfinite(dem) & (dem > -1000)
healed, _ = read(SRC["healed"])
healed = np.where(np.isfinite(healed) & (healed > -1000) & valid, healed, dem)
acc, _ = read(SRC["acc"])
acc = np.where(np.isfinite(acc) & (acc > 0), acc, 0)
road, _ = read(SRC["road"])
road = (np.isfinite(road) & (road > 0)).astype("f4")

# Fill holes and the outside of the watershed with the nearest valid height so
# sampling near the data edge never sees a nodata spike.
idx = ndi.distance_transform_edt(~valid, return_distances=False, return_indices=True)
dem = dem[idx[0], idx[1]]
healed = healed[idx[0], idx[1]]

zmin = float(np.floor(dem.min()))
zscale = 0.01
assert (dem.max() - zmin) / zscale < 65535

c0, r0, n = args.col0, args.row0, args.size
assert 0 <= c0 and c0 + n <= W and 0 <= r0 and r0 + n <= H, "core window outside the DEM"
core = (slice(r0, r0 + n), slice(c0, c0 + n))


# ---- stream water ---------------------------------------------------------
WATER_MIN = 4e4  # m2 of drainage before a channel is drawn with water in it


def water_fields(a):
    """From flow accumulation: signed distance inside the water's edge (m),
    and the flow direction (east, south) scaled by speed (0.25 slow .. 1 fast)."""
    cells = (a >= WATER_MIN) & valid
    # Each stream cell drains to its neighbour with the most accumulation.
    best, bx, by = a.copy(), np.zeros(a.shape, "f4"), np.zeros(a.shape, "f4")
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx or dy:
                n = shifted(a, dy, dx, 0)
                better = n > best
                best[better], bx[better], by[better] = n[better], dx, dy
    norm = np.maximum(np.hypot(bx, by), 1e-6)
    bx, by = bx / norm, by / norm
    half_width = np.minimum(0.45 * (np.maximum(a, WATER_MIN) / WATER_MIN) ** 0.33, 3.0)
    dist, idx = ndi.distance_transform_edt(~cells, return_indices=True)
    near = (idx[0], idx[1])
    # Blurring rounds the stair-steps of a stream traced cell to cell.
    sdf = ndi.gaussian_filter(half_width[near] - dist, 1.3)
    fx, fy = ndi.gaussian_filter(bx[near], 3.0), ndi.gaussian_filter(by[near], 3.0)
    norm = np.maximum(np.hypot(fx, fy), 1e-6)
    # Speed from the fall of the channel along its own course (not the banks' slope).
    gyy, gxx = np.gradient(ndi.gaussian_filter(dem, 3.0))
    fall = np.maximum(-(gxx * bx + gyy * by), 0)
    speed = np.clip(0.2 + ndi.gaussian_filter(fall[near], 4.0) / 0.09, 0.2, 1.0)
    return sdf, fx / norm * speed, fy / norm * speed, cells


acc_healed, _ = read(SRC["acc_healed"])
acc_healed = np.where(np.isfinite(acc_healed) & (acc_healed > 0), acc_healed, 0)
water = {"": water_fields(acc), "_healed": water_fields(acc_healed)}


def save_water(level, pick):
    for suffix, (sdf, fx, fy, _) in water.items():
        save_rgb(f"{level}_water{suffix}.png", 0.5 + pick(sdf) / 8.0, 0.5 + 0.5 * pick(fx), 0.5 + 0.5 * pick(fy))


# ---- shared helpers ---------------------------------------------------------
gy, gx = np.gradient(healed)
slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))
road_soft = ndi.gaussian_filter(road, 0.8)
edge_dist = ndi.distance_transform_edt(valid)
rng = np.random.default_rng(7)


def smooth_noise(sigma, rng=rng):
    f = ndi.gaussian_filter(rng.standard_normal((H // 4 + 1, W // 4 + 1)).astype("f4"), sigma / 4)
    f = (f - f.mean()) / f.std()
    return ndi.zoom(f, 4, order=1)[:H, :W]


def sstep(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def core_weight(r, c):
    """1 in and near the 1 m window, falling to 0 a few hundred metres out:
    stems are only worth placing one by one where they can be seen."""
    d = np.hypot(np.maximum(np.maximum(r0 - r, r - (r0 + n)), 0), np.maximum(np.maximum(c0 - c, c - (c0 + n)), 0))
    return np.clip((350.0 - d) / 250.0, 0, 1)


near_water = np.maximum(water[""][0], water["_healed"][0])      # metres inside the water's edge, either state

# ---- the valley before incision ---------------------------------------------
# Measured on the road-healed surface, relative to the channels it drains to.
chan = (acc_healed >= WATER_MIN) & valid
cdist, cind = ndi.distance_transform_edt(~chan, return_indices=True)
cnear = (cind[0], cind[1])
zh = (healed - zmin).astype("f4")
bed = np.where(chan, ndi.gaussian_filter(zh * chan, 6) / np.maximum(ndi.gaussian_filter(chan.astype("f4"), 6), 1e-9), 0)
rel = zh - bed[cnear]                                           # height above the nearest channel bed
slope_s, slope_b = ndi.gaussian_filter(slope_deg, 3), ndi.gaussian_filter(slope_deg, 12)

# Terrace height: flat ground 0.8 to 4 m above a channel, within 80 m of it, is
# taken to be the floodplain the channel has since cut below. Reaches with
# little such ground (confined valleys) are treated as not incised.
terrace = (slope_s < 8) & (rel > 0.8) & (rel < 4.0) & (cdist < 80)
num, den = np.zeros(zh.shape, "f4"), np.zeros(zh.shape, "f4")
np.add.at(num, (cnear[0][terrace], cnear[1][terrace]), rel[terrace])
np.add.at(den, (cnear[0][terrace], cnear[1][terrace]), 1.0)
num, den, length = ndi.gaussian_filter(num, 30), ndi.gaussian_filter(den, 30), ndi.gaussian_filter(chan.astype("f4"), 30)
per_metre = den / np.maximum(length, 1e-9)                      # m2 of terrace per metre of channel
incision = np.where(chan, np.minimum(num / np.maximum(den, 1e-9), 3.2) * np.clip((per_metre - 5) / 15, 0, 1), 0)
incision = ndi.gaussian_filter(incision[cnear], 18)             # carried out from each channel, seams smoothed
fill = np.clip(incision - rel, 0, None) * np.clip((75 - cdist) / 15, 0, 1)
fill = ndi.gaussian_filter(fill, 2.0)
rel_filled = rel + fill
# Before incision the stream ran in a shallow channel at the meadow's surface.
fill = np.clip(fill - 0.35 * np.clip(water["_healed"][0] + 0.8, 0, 1) * np.clip(fill / 0.8, 0, 1), 0, 4.0)
filled = healed + fill

# Zones. Meadow: gentle ground near the level of the terrace, near a channel.
floor_wet = np.clip((incision + 1.9 - rel_filled) / 0.9, 0, 1) * np.clip((12 - slope_b) / 4, 0, 1) * np.clip((200 - cdist) / 80, 0, 1)
floor_wet = ndi.gaussian_filter(floor_wet, 4)
# Inset floodplain: low, flat ground beside the channel as surveyed. It stays wet.
inset_wet = np.clip((1.25 - rel) / 0.5, 0, 1) * np.clip((12 - slope_s) / 5, 0, 1) * np.clip((55 - cdist) / 20, 0, 1)
inset_wet = ndi.gaussian_filter(inset_wet, 1.5)
# Hollows hold their moisture longer; ground beside channels that never cut down keeps it for good.
# The order in which the meadow dries once its channel has cut down: from the
# edges inward (0 at the forest edge, 0.8 beside the channel), hollows a little
# later than their surroundings. Ground beside channels that never cut down
# keeps its water for good (1).
edge_in = ndi.distance_transform_edt(floor_wet > 0.4)           # metres into the meadow from its edge
hollow = sstep(0.75 * smooth_noise(30) + 0.3 * smooth_noise(10), 0.45, 1.25)
order = np.clip(0.8 * (edge_in / (edge_in + cdist + 1.0)) ** 0.8 + 0.16 * hollow, 0, 0.8)
hold = np.maximum(order, 1 - np.clip(incision / 1.2, 0, 1))

# Headcuts. A channel cuts down from below: a step in its bed (a headcut) works
# its way upstream, and behind it the trench is at full depth. Here every
# incised reach (a run of channel with a terrace beside it) gets its own
# headcut, which enters at the reach's downstream end when the cutting starts
# and climbs at HEADCUT_SPEED, so all the meadows are captured over the same
# stage. `arrive` is when it reaches a spot, 0..1 over CUT_SPAN.
# First, distance upstream along the channels from the watershed's outlet.
flow_dist = np.full(zh.shape, -1.0, "f4")
start = np.unravel_index(np.argmax(np.where(chan, acc_healed, 0)), zh.shape)
flow_dist[start] = 0
queue = deque([start])
while queue:
    i, j = queue.popleft()
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            a, b = i + di, j + dj
            if (di or dj) and 0 <= a < H and 0 <= b < W and chan[a, b] and flow_dist[a, b] < 0:
                flow_dist[a, b] = flow_dist[i, j] + (1.414 if di and dj else 1.0)
                queue.append((a, b))
reached = flow_dist >= 0
# Reaches: channel that has cut down, joined across short confined stretches.
reach = reached & (ndi.maximum_filter(np.where(chan, incision, 0), 41) > 0.3)
reach_id, reaches = ndi.label(reach, structure=np.ones((3, 3)))
ids = np.arange(1, reaches + 1)
lo = np.asarray(ndi.minimum(flow_dist, reach_id, ids))
length = np.asarray(ndi.maximum(flow_dist, reach_id, ids)) - lo
took = np.minimum(length / HEADCUT_SPEED, CUT_SPAN)             # stages each reach's headcut is on the move
arrive_chan = np.zeros(zh.shape, "f4")
on = reach_id > 0
k = reach_id[on] - 1
arrive_chan[on] = (flow_dist[on] - lo[k]) / np.maximum(length[k], 1.0) * took[k] / CUT_SPAN
# Ground beside a channel is cut when its channel is; the seams between
# neighbouring channels are smoothed.
arrive = np.clip(ndi.gaussian_filter(arrive_chan[cnear], 5), 0, 1)
cut_stage = CUT_START + CUT_SPAN * arrive                        # the stage at which each spot starts to cut down
in_core = np.zeros(zh.shape, bool)
in_core[r0:r0 + n, c0:c0 + n] = True
seen = np.unique(reach_id[on & in_core])
print(f"headcuts: {reaches} incised reaches in the watershed, {seen.size} in the window; lengths there (m): "
      + " ".join(f"{length[i - 1]:.0f}" for i in seen[np.argsort(-length[seen - 1])][:12]), flush=True)

# Banks do not retreat as a line parallel to the channel: they fail in slumps.
# The distance that decides when the bank passes a spot is the true distance
# from the channel's centre line with bays and points added to it (none within
# the first few metres, where the slot is cut).
# (Its own random numbers, so everything drawn after it stays as it was.)
bank_rng = np.random.default_rng(23)
bank_dist = np.maximum(cdist + sstep(cdist, 3.0, 12.0) * (6.0 * smooth_noise(8, bank_rng) + 3.0 * smooth_noise(3, bank_rng)), 0)

# ---- the meadow's many small channels (before one channel captures the flow) ----
# Noise smeared along the direction of flow has long, lens-shaped contours;
# its zero contour is a network of threads that split and rejoin around
# islands. Only made near the 1 m window: at 4 m a thread is not resolvable.
tm = 80
wr0, wr1, wc0, wc1 = max(0, r0 - tm), min(H, r0 + n + tm), max(0, c0 - tm), min(W, c0 + n + tm)
STEP = 2                                                        # worked out on a 2 m grid
sub = (slice(wr0, wr1, STEP), slice(wc0, wc1, STEP))
ux, uy = ndi.gaussian_filter(water["_healed"][1][sub], 7), ndi.gaussian_filter(water["_healed"][2][sub], 7)
un = np.maximum(np.hypot(ux, uy), 1e-6)
ux, uy = ux / un, uy / un                                       # unit flow direction (east, south), from the nearest channel
base = ndi.gaussian_filter(rng.standard_normal(ux.shape).astype("f4"), 4.0)
smeared = base.copy()
yy, xx = np.mgrid[0:ux.shape[0], 0:ux.shape[1]].astype("f4")
for sign in (1, -1):
    py, px = yy.copy(), xx.copy()
    for _ in range(28):                                         # 28 steps of 3 m each way
        vx = ndi.map_coordinates(ux, [py, px], order=1, mode="nearest")
        vy = ndi.map_coordinates(uy, [py, px], order=1, mode="nearest")
        px += sign * 1.5 * vx
        py += sign * 1.5 * vy
        smeared += ndi.map_coordinates(base, [py, px], order=1, mode="nearest")
smeared -= ndi.gaussian_filter(smeared, 25)
smeared /= smeared.std()
# Back to 1 m before taking the contour: its band is narrower than a 2 m cell.
fine = lambda a, order: ndi.zoom(a, STEP, order=order)[:wr1 - wr0, :wc1 - wc0]
smeared = fine(smeared, 3)
gy_, gx_ = np.gradient(smeared)
steep = np.hypot(gx_, gy_)                                      # per metre
steep = np.maximum(steep, 0.45 * np.median(steep))              # where the field is nearly flat a thread swells into a pool
half_width = np.clip(1.0 + 0.35 * fine(ndi.gaussian_filter(rng.standard_normal(ux.shape).astype("f4"), 6), 1) / 0.05, 0.7, 1.5)
thread_sdf = np.full((H, W), -4.0, "f4")
# Two sets of contours: the zero line, and a slimmer one either side of it, so
# threads run in loose bundles around lens-shaped islands.
thread_sdf[wr0:wr1, wc0:wc1] = np.maximum(half_width - np.abs(smeared) / steep,
                                          0.75 * half_width - np.abs(np.abs(smeared) - 1.05) / steep)
# Threads belong to the wet meadow, and peter out here and there.
gaps = sstep(smooth_noise(55), 0.9, 1.5)
thread_sdf = np.clip(thread_sdf - 5.0 * (1 - sstep(floor_wet, 0.45, 0.75)) - 5.0 * gaps, -4, 4)

# ---- flight path -----------------------------------------------------------------
# Downstream all the way: from the head of the tributary through --path-via (the
# gully that has cut into the south-west meadow), down it to the main stream,
# and on down the main stream through the lower meadow to where it leaves the window.
edge = 40
a = acc[core].copy()
a[:edge, :] = a[-edge:, :] = 0
a[:, :edge] = a[:, -edge:] = 0


def trace_up(r, c, stop=2000):
    out = [(r, c)]
    while True:
        win = a[r - 1:r + 2, c - 1:c + 2].copy()
        win[win >= a[r, c]] = 0  # only step upstream
        if win.max() < stop:
            return out
        dr, dc = np.unravel_index(np.argmax(win), win.shape)
        r, c = r + dr - 1, c + dc - 1
        out.append((r, c))


main = trace_up(*np.unravel_index(np.argmax(a), a.shape))[::-1]        # upstream -> downstream
vx, vz = (int(v) for v in args.path_via.split(","))
near_via = a[vz - 8:vz + 9, vx - 8:vx + 9]
dr, dc = np.unravel_index(np.argmax(near_via), near_via.shape)
r, c = vz - 8 + dr, vx - 8 + dc
on_main = {p: i for i, p in enumerate(main)}
down = []                                                               # from the via point down to the main stream
while (r, c) not in on_main and len(down) < 3000:
    down.append((r, c))
    win = a[r - 1:r + 2, c - 1:c + 2]
    dr, dc = np.unravel_index(np.argmax(win), win.shape)
    if win[dr, dc] <= a[r, c]:
        break
    r, c = r + dr - 1, c + dc - 1
joined = (r, c) in on_main
trace = np.array(trace_up(*down[0], stop=3000)[::-1] + down[1:] + main[on_main[(r, c)]:] if joined else main, "f8")
sm = ndi.gaussian_filter1d(trace, 30, axis=0, mode="nearest")
seg = np.hypot(*np.diff(sm, axis=0).T)
s = np.concatenate([[0], np.cumsum(seg)])
t = np.arange(0, s[-1], 12.0)
path = np.column_stack([np.interp(t, s, sm[:, 1]) + 0.5, np.interp(t, s, sm[:, 0]) + 0.5])  # x east, z south (m)

# No tree within a few metres of the stream flight (?tour=stream): the camera should not fly through trunks.
# The camera circles one meadow lobe, so the changes are watched in one place.
# Centre: a spot on a channel that cut down, with the most meadow around it.
ORBIT_R, ORBIT_H, ORBIT_START = 115.0, 50.0, 0.24 * np.pi   # above the tallest trees, looking down at about 20 degrees; starts looking up-valley
if args.orbit != "auto":
    ox, oz = (float(v) for v in args.orbit.split(","))
else:
    score = ndi.gaussian_filter(floor_wet * (hold < 0.9), 55) * np.clip(ndi.gaussian_filter(fill, 12) / 1.0, 0, 1)
    margin = int(ORBIT_R) + 70
    score[:r0 + margin] = 0; score[r0 + n - margin:] = 0; score[:, :c0 + margin] = 0; score[:, c0 + n - margin:] = 0
    score[~chan] = 0
    orr, occ = np.unravel_index(np.argmax(score), score.shape)
    ox, oz = float(occ - c0), float(orr - r0)

_or, _oc = int(oz) + r0, int(ox) + c0
_cut = cut_stage[_or - 110:_or + 110, _oc - 110:_oc + 110][reach[_or - 110:_or + 110, _oc - 110:_oc + 110]]
print(f"the headcut passes the circled meadow between stages {_cut.min():.2f} and {_cut.max():.2f} "
      f"(its centre at {cut_stage[_or, _oc]:.2f})", flush=True)

# The landscape view: a wide, high circle that takes in all the meadows of the
# 1 m window at once (and the rest of the watershed beyond them).
mw = floor_wet[core]
myy, mxx = np.mgrid[0:n, 0:n]
lx, lz = float((mw * mxx).sum() / mw.sum()), float((mw * myy).sum() / mw.sum())
spread = float(np.percentile(np.hypot(mxx - lx, myy - lz)[mw > 0.5], 90))
LAND_R = round(1.25 * spread + 120.0)
landscape = {"x": round(lx), "z": round(lz), "radius": LAND_R, "height": round(0.72 * LAND_R), "period": 300}
print(f"landscape view: circles {landscape['x']}, {landscape['z']} at {LAND_R} m, {landscape['height']} m up (nine tenths of the window's meadow lies within {spread:.0f} m of it)", flush=True)

on_path = np.zeros((H, W), bool)
on_path[np.clip(np.rint(sm[:, 0]).astype(int) + r0, 0, H - 1), np.clip(np.rint(sm[:, 1]).astype(int) + c0, 0, W - 1)] = True
path_dist = ndi.distance_transform_edt(~on_path)

# ---- trees ---------------------------------------------------------------------
# Three populations. Upland forest stands from the start. On the meadow that
# dries, a dense cohort of young conifers germinates (first at the forest edge,
# last in the hollows), most of which die as the stand closes; one in a dozen or
# so survives to make the mature forest. Late on, firs come up underneath.
CARDS = os.path.join(OUT, "cards.json")
cards = json.load(open(CARDS)) if os.path.exists(CARDS) else None
kinds = [t["kind"] for t in cards["trees"]] if cards else []
of = lambda k: np.array([i for i, x in enumerate(kinds) if x == k] or [0], int)
firs, pines, fir_saps, pine_saps, snag_types = of("fir"), of("pine"), of("sapling"), of("pinesapling"), of("snag")
tall_snags = np.array([i for i in snag_types if cards and cards["trees"][i]["height"] > 12] or [0], int)
short_snags = np.array([i for i in snag_types if cards and cards["trees"][i]["height"] <= 12] or [0], int)


def choose(options, u):
    return options[np.minimum((u * len(options)).astype(int), len(options) - 1)]


def jittered(spacing, r_lo, r_hi, c_lo, c_hi):
    gr, gc = np.meshgrid(np.arange(r_lo + spacing / 2, r_hi, spacing), np.arange(c_lo + spacing / 2, c_hi, spacing), indexing="ij")
    r = gr.ravel() + rng.uniform(-0.47, 0.47, gr.size) * spacing
    c = gc.ravel() + rng.uniform(-0.47, 0.47, gc.size) * spacing
    return np.clip(r, 0, H - 1.001), np.clip(c, 0, W - 1.001)


# Roads are planted like the ground around them: the story is told with the
# roads erased, and from the air a treeless strip is a road all the same. Each
# tree on a road's line is marked, and is taken away when the roads are shown.
road_cell = ndi.maximum_filter(road, 5) >= 0.5
buildable = (edge_dist > 3) & (near_water < -1.0) & (slope_deg < 44) & (path_dist > 5.5)
upland = floor_wet <= 0.4                                          # forest from the start
dries = (floor_wet > 0.4) & (hold < 0.9) & (inset_wet < 0.4)       # meadow the conifers will take
forest_dist = ndi.distance_transform_edt(~upland)                  # metres into the meadow from standing forest
pine_stand = smooth_noise(170)
NEVER = 99.0


def birth_at(ir, ic, spread):
    """When a conifer can establish: as the ground there dries, so the trees
    follow the drying front in from the meadow's edge."""
    b = cut_stage[ir, ic] + 0.35 + DRY_SPAN * hold[ir, ic] + 0.6 * DRY_WIDTH
    return b + rng.normal(0, spread, ir.size)


def species(pine, u):
    """Sapling and mature picture for each tree."""
    fir_pick = np.where(u < 0.1, firs[-1], choose(firs[:-1] if len(firs) > 1 else firs, u))  # the sparse fir is rare
    return np.where(pine, choose(pine_saps, u), choose(fir_saps, u)), np.where(pine, choose(pines, u), fir_pick)


groups = []


def add(r, c, hmax, birth, death, young, mature, snag, meadow):
    groups.append(dict(r=r, c=c, hmax=hmax, birth=np.broadcast_to(birth, r.shape).astype("f4"), death=np.broadcast_to(death, r.shape).astype("f4"),
                       young=young, mature=mature, snag=snag, meadow=np.full(r.size, meadow), road=road_cell[r.astype(int), c.astype(int)]))


sp = args.tree_spacing
# Upland forest.
r, c = jittered(sp, 0, H, 0, W)
ir, ic = r.astype(int), c.astype(int)
stand = 0.5 + 0.5 * np.tanh(0.9 * smooth_noise(70))[ir, ic]
ok = buildable[ir, ic] & upland[ir, ic] & (rng.uniform(size=r.size) < 0.62 + 0.38 * stand)
r, c, ir, ic = r[ok], c[ok], ir[ok], ic[ok]
h = (24 + 9 * smooth_noise(120)[ir, ic]) * rng.lognormal(0, 0.22, r.size)
small = rng.uniform(size=r.size) < 0.22                             # understory and young trees
h = np.clip(np.where(small, h * rng.uniform(0.25, 0.55, r.size), h), 3.5, 50)
u = rng.uniform(size=r.size)
young, mature = species(pine_stand[ir, ic] + rng.normal(0, 0.35, r.size) > 0.4, u)
kind = np.where(h < 10, young, mature)                              # an upland tree keeps one picture throughout
kind = np.where(rng.uniform(size=r.size) < 0.04, np.where(h < 10, choose(short_snags, u), choose(tall_snags, u)), kind)  # standing dead
add(r, c, h, -10.0, NEVER, kind, kind, kind, False)

# Survivors of the meadow cohort: the trees of the mature forest.
r, c = jittered(sp, 0, H, 0, W)
ir, ic = r.astype(int), c.astype(int)
ok = buildable[ir, ic] & dries[ir, ic] & (near_water[ir, ic] < -3) & (rng.uniform(size=r.size) < 0.8)
r, c, ir, ic = r[ok], c[ok], ir[ok], ic[ok]
u = rng.uniform(size=r.size)
young, mature = species(rng.uniform(size=r.size) < 0.75, u)
add(r, c, np.clip(30 * rng.lognormal(0, 0.12, r.size), 22, 37), birth_at(ir, ic, 0.18), NEVER, young, mature, choose(tall_snags, u), True)

# The rest of the cohort: thicket stems that die as the stand closes. Placed one
# by one only near the window.
ENC = 1.7                                                           # metres between stems in a thicket
m = 350
r, c = jittered(ENC, max(0, r0 - m), min(H, r0 + n + m), max(0, c0 - m), min(W, c0 + n + m))
ir, ic = r.astype(int), c.astype(int)
thick = 0.5 + 0.5 * np.tanh(1.2 * smooth_noise(25))[ir, ic]
ok = buildable[ir, ic] & dries[ir, ic] & (near_water[ir, ic] < -3) & (rng.uniform(size=r.size) < core_weight(r, c) * (0.4 + 0.6 * thick))
r, c, ir, ic = r[ok], c[ok], ir[ok], ic[ok]
u = rng.uniform(size=r.size)
young, mature = species(rng.uniform(size=r.size) < 0.8, u)
hmax, birth = rng.uniform(9, 17, r.size), birth_at(ir, ic, 0.22)
death = birth + rng.uniform(1.4, 2.5, r.size)
snag = np.where(tree_height(hmax, birth, death, death) >= 11, choose(tall_snags, u), choose(short_snags, u))
add(r, c, hmax, birth, death, young, mature, snag, True)

# Firs coming up under the closed canopy.
r, c = jittered(sp, 0, H, 0, W)
ir, ic = r.astype(int), c.astype(int)
ok = buildable[ir, ic] & dries[ir, ic] & (near_water[ir, ic] < -3) & (rng.uniform(size=r.size) < 0.3)
r, c = r[ok], c[ok]
u = rng.uniform(size=r.size)
add(r, c, rng.uniform(16, 22, r.size), rng.uniform(5.0, 5.9, r.size), NEVER, choose(fir_saps, u), choose(firs[:-1] if len(firs) > 1 else firs, u), choose(short_snags, u), True)

# Willows. Clumps stand along the meadow's small channels from the start. When
# the channel cuts down, the water table drops away beneath them and they die
# back as their ground dries. On the new floodplain inside the trench, willows
# establish once the banks have retreated and the floor has greened. (Their own
# random numbers, so the conifers stay where they were.)
willow_types, dead_willow_types = of("willow"), of("deadwillow")
n_willows = [0, 0]
if "willow" in kinds:
    wrng = np.random.default_rng(31)
    sp_w = 3.5
    gr, gc = np.meshgrid(np.arange(sp_w / 2, H, sp_w), np.arange(sp_w / 2, W, sp_w), indexing="ij")
    r = np.clip(gr.ravel() + wrng.uniform(-0.47, 0.47, gr.size) * sp_w, 0, H - 1.001)
    c = np.clip(gc.ravel() + wrng.uniform(-0.47, 0.47, gc.size) * sp_w, 0, W - 1.001)
    ir, ic = r.astype(int), c.astype(int)
    clumped = sstep(smooth_noise(16, wrng), 0.1, 0.9)[ir, ic]          # willows grow in thickets, with gaps between
    u = wrng.uniform(size=(5, r.size))
    standable = (edge_dist > 3)[ir, ic] & (ndi.maximum_filter(road, 5) < 0.5)[ir, ic] & (slope_deg < 25)[ir, ic]
    beside = lambda sdf, near, far: (sdf[ir, ic] < -near) & (sdf[ir, ic] > -far)
    # On the meadow as it was: beside a thread or the stream, on ground that will not be cut away.
    old = standable & (floor_wet[ir, ic] > 0.55) & (fill[ir, ic] < 0.3) & (beside(thread_sdf, 0.4, 3.0) | beside(water["_healed"][0], 0.6, 4.5)) \
        & (u[0] < 0.08 + 0.7 * clumped)
    dies = np.where(hold[ir, ic] >= 0.95, NEVER, cut_stage[ir, ic] + 0.35 + DRY_SPAN * hold[ir, ic] + DRY_WIDTH * (0.6 + 1.2 * u[1]))
    # On the trench's floor: willows are among the first plants onto raw sediment,
    # soon after the bank has passed, and are shrubs a couple of stages later.
    passed = np.clip((bank_dist[ir, ic] - SLOT) / (80 - SLOT), 0, 1) ** (2 / 3)
    new = standable & (inset_wet[ir, ic] > 0.5) & (fill[ir, ic] >= 0.3) & beside(water[""][0], 0.8, 14.0) & (u[0] < 0.08 + 0.7 * clumped)
    comes = cut_stage[ir, ic] + 0.7 * CUT_TIME + passed * WIDEN_TIME + 0.2 + 0.8 * u[1]
    for which, (ok, born, died) in enumerate([(old, np.full(r.size, -10.0), dies), (new, comes, np.full(r.size, NEVER))]):
        pick = np.minimum((u[2][ok] * len(willow_types)).astype(int), len(willow_types) - 1)
        kind_w = willow_types[pick]
        add(r[ok], c[ok], np.clip(2.7 * np.exp(0.28 * (u[3][ok] + u[4][ok] - 1) / 0.41), 1.4, 4.6), born[ok], died[ok],
            kind_w, kind_w, dead_willow_types[np.minimum(pick, len(dead_willow_types) - 1)], True)
        n_willows[which] = int(ok.sum())
    print(f"willows: {n_willows[0]} on the meadow from the start, {n_willows[1]} that come up inside the trench", flush=True)

tr, tc, hmax, birth, death, t_young, t_mature, t_snag, meadow_tree, road_tree = (np.concatenate([g[k] for g in groups]) for k in
                                                                     ("r", "c", "hmax", "birth", "death", "young", "mature", "snag", "meadow", "road"))


def stage_byte(s):
    """A stage (-1..7) as a byte. 0 means "from the start", 255 "never"."""
    b = np.clip(np.rint((s + 1) / 8 * 255), 1, 254)
    return np.where(s < -1, 0, np.where(s > 7, 255, b)).astype("u1")


trees = np.zeros(tr.size, dtype=[("x", "<u2"), ("z", "<u2"), ("hmax", "u1"), ("birth", "u1"), ("death", "u1"), ("seed", "u1"),
                                 ("young", "u1"), ("mature", "u1"), ("snag", "u1"), ("road", "u1")])
trees["x"] = np.rint(tc * 10)                 # decimetres east of the DEM's west edge
trees["z"] = np.rint(tr * 10)                 # decimetres south of its north edge
trees["hmax"] = np.rint(np.clip(hmax, 0, 51) / 0.2)
trees["birth"] = stage_byte(birth)      # 0 = standing from the start
trees["death"] = stage_byte(death)      # 255 = never
trees["seed"] = rng.integers(0, 256, tr.size)
trees["young"], trees["mature"], trees["snag"] = t_young, t_mature, t_snag
trees["road"] = road_tree                # 1 = stands on a road's line: there only while the roads are hidden
trees[np.argsort(trees["birth"], kind="stable")].tofile(os.path.join(OUT, "trees.bin"))

# ---- downed wood -----------------------------------------------------------
# Logs lie through the upland forest from the start. On the meadow they appear
# as the thicket thins itself. Only placed inside the 1 m window.
r, c = jittered(5.0, r0, r0 + n, c0, c0 + n)
ir, ic = r.astype(int), c.astype(int)
chance = np.where(upland[ir, ic], 0.16, np.where(dries[ir, ic], 0.22, 0.0))
ok = valid[ir, ic] & (ndi.maximum_filter(road, 7)[ir, ic] < 0.5) & (near_water[ir, ic] < -1.5) & (slope_deg[ir, ic] < 30) & (rng.uniform(size=r.size) < chance)
r, c, ir, ic = r[ok], c[ok], ir[ok], ic[ok]
appear = np.where(upland[ir, ic], -10.0, birth_at(ir, ic, 0.2) + rng.uniform(1.7, 2.8, r.size))
ok = appear < 6.6
r, c, ir, ic, appear = r[ok], c[ok], ir[ok], ic[ok], appear[ok]
big = rng.uniform(size=r.size) < np.where(upland[ir, ic], 0.6, np.where(appear > 5.3, 0.12, 0.0))   # an old log, or a fallen pole
logs = np.zeros(r.size, dtype=[("x", "<u2"), ("z", "<u2"), ("heading", "u1"), ("size", "u1"), ("stretch", "u1"), ("appear", "u1"), ("seed", "u1"), ("model", "u1")])
logs["x"], logs["z"] = np.rint((c - c0) * 10), np.rint((r - r0) * 10)     # decimetres from the window's north-west corner
logs["heading"] = rng.integers(0, 256, r.size)
logs["model"] = np.where(big, rng.uniform(size=r.size) < 0.6, 0)          # the stout scan for most old logs, the slim one for poles
logs["size"] = np.rint(50 * np.where(big, np.where(logs["model"] == 1, rng.uniform(0.7, 1.4, r.size), rng.uniform(1.6, 3.0, r.size)),
                                     rng.uniform(0.35, 0.9, r.size)))
logs["stretch"] = np.rint(100 * rng.uniform(1.0, 2.3, r.size))
logs["appear"] = stage_byte(appear)     # 0 = lying there from the start
logs["seed"] = rng.integers(0, 256, r.size)
logs.tofile(os.path.join(OUT, "log_places.bin"))
n_logs, n_big_logs = r.size, int(big.sum())


def crown_profiles():
    """For each tree type, the crown's top and underside by distance from the
    trunk (all in metres at the scanned size), read off the card silhouettes."""
    if not cards:  # no cards baked yet: a plain cone
        r = np.arange(0, 6, 0.25)
        return [dict(r=r, top=20 * np.clip(1 - r / 3.5, 0, 1), bot=np.zeros_like(r), solid=np.where(r < 3.5, 0.8, 0.0), height=20.0)]
    alpha = np.array(Image.open(os.path.join(OUT, "cards_a.webp")))[..., 3] > 90
    cw, ch = cards["cell"]
    out = []
    for i, t in enumerate(cards["trees"]):
        col, row = divmod(i, cards["rows"])
        strip = cw * cards["views"]
        cell = alpha[row * ch:(row + 1) * ch, col * strip:(col + 1) * strip].reshape(ch, cards["views"], cw)
        y = (1 - (np.arange(ch) + 0.5) / ch) * t["frameHeight"] + t["frameBottom"]  # height of each texel row
        offset = np.abs((np.arange(cw) + 0.5) / cw - 0.5) * t["frameWidth"]          # distance of each column from the trunk
        r = np.arange(0, offset.max(), 0.25)
        top, bot, solid = np.zeros(r.size), np.zeros(r.size), np.zeros(r.size)
        for k in range(r.size):
            cols = cell[:, :, np.abs(offset - r[k]) < 0.2]                            # all views, both sides
            if not cols.any():
                continue
            covered = cols.any(axis=0)
            hi = np.where(cols, y[:, None, None], -np.inf).max(axis=0)[covered]
            lo = np.where(cols, y[:, None, None], np.inf).min(axis=0)[covered]
            top[k], bot[k] = np.median(hi), np.median(lo)
            between = (y[:, None, None] <= top[k]) & (y[:, None, None] >= bot[k])
            solid[k] = cols[np.broadcast_to(between, cols.shape)].mean() * covered.mean()
        bot[r < 0.4] = 0.0  # the trunk reaches the ground
        solid[r < 0.4] = 1.0
        out.append(dict(r=r, top=top, bot=bot, solid=solid, height=t["height"]))
    return out


profiles = crown_profiles()




profiles = crown_profiles()
stamps = {}


def stamp(top, bot, rows, cols, heights, types):
    """Add trees to the canopy: its top and underside over each cell (absolute
    heights; cells with no crown above keep top = -inf)."""
    for r, c, h, ty in zip(rows, cols, np.rint(heights).astype(int), types):
        key = (int(ty), int(h))
        if key not in stamps:
            pf = profiles[min(int(ty), len(profiles) - 1)]
            scale = h / pf["height"]
            R = int(np.ceil(pf["r"][pf["solid"] > 0].max(initial=0.5) * scale)) + 1
            yy, xx = np.mgrid[-R:R + 1, -R:R + 1]
            d = np.hypot(yy, xx) / scale
            here = np.interp(d, pf["r"], pf["solid"], right=0) > 0.04
            stamps[key] = (R, np.where(here, np.interp(d, pf["r"], pf["top"]) * scale, -np.inf).astype("f4"),
                           np.where(here, np.interp(d, pf["r"], pf["bot"]) * scale, np.inf).astype("f4"))
        R, st, sb = stamps[key]
        i, j = int(r), int(c)
        a0, a1, b0, b1 = max(0, i - R), min(H, i + R + 1), max(0, j - R), min(W, j + R + 1)
        sl = (slice(a0 - i + R, a1 - i + R), slice(b0 - j + R, b1 - j + R))
        np.maximum(top[a0:a1, b0:b1], dem[i, j] + st[sl], out=top[a0:a1, b0:b1])
        np.minimum(bot[a0:a1, b0:b1], dem[i, j] + sb[sl], out=bot[a0:a1, b0:b1])


CROWN_DENSITY = 0.3  # light lost per metre of crown; about 85% through a 6 m crown


def tree_light(ground, top, bot, cell, reach):
    """Fraction of sunlight reaching the ground past the canopy, 0..1. A ray
    toward the sun loses light for every metre it spends between a crown's
    underside and its top, so thin crown edges and single trunks cast lighter
    shadows than the middle of a stand. Two sun heights soften the edges."""
    az = np.radians(args.sun_az)
    ux, uy = np.sin(az), -np.cos(az)
    lit = np.zeros(ground.shape, "f4")
    alts = (args.sun_alt - 1.3, args.sun_alt + 1.3)
    for alt in alts:
        rise = np.tan(np.radians(alt))
        through = np.zeros(ground.shape, "f4")  # metres of crown along the ray
        seen = set()
        for d in np.arange(cell, reach + cell, cell):
            dx, dy = int(round(d * ux / cell)), int(round(d * uy / cell))
            if (dx, dy) == (0, 0) or (dx, dy) in seen:
                continue
            seen.add((dx, dy))
            ray = ground + np.hypot(dx, dy) * cell * rise
            through += cell * ((shifted(bot, dy, dx, np.inf) <= ray) & (ray <= shifted(top, dy, dx, -np.inf)))
        lit += np.exp(-CROWN_DENSITY * through)
    return ndi.gaussian_filter(lit / len(alts), 0.5)


# ---- levels ------------------------------------------------------------------
fc = args.far_cell
fh, fw = H // fc, W // fc


def block(a):
    return a[:fh * fc, :fw * fc].reshape(fh, fc, fw, fc).mean(axis=(1, 3))


def block_max(a):
    return a[:fh * fc, :fw * fc].reshape(fh, fc, fw, fc).max(axis=(1, 3))


def deg45(t):
    return np.degrees(np.arctan(t)) / 45.0


def save_stack(name, layers, quality):
    """Greyscale layers stacked top to bottom in one image."""
    Image.fromarray(np.vstack([to8(a) for a in layers]), "L").save(os.path.join(OUT, name), quality=quality, method=6)


far_z = block(dem)
shadow_reach = min(260.0, float(hmax.max()) / np.tan(np.radians(args.sun_alt - 1.3)))
tpad = int(shadow_reach) + 2          # tree shadows only reach a few hundred metres
tr0, tr1, tc0, tc1 = max(0, r0 - tpad), min(H, r0 + n + tpad), max(0, c0 - tpad), min(W, c0 + n + tpad)
twin = (slice(tr0, tr1), slice(tc0, tc1))
tinner = (slice(r0 - tr0, r0 - tr0 + n), slice(c0 - tc0, c0 - tc0 + n))

# ---- tree shade at each key stage --------------------------------------------
top_up, bot_up = np.full((H, W), -np.inf, "f4"), np.full((H, W), np.inf, "f4")
up = ~meadow_tree
stamp(top_up, bot_up, tr[up], tc[up], hmax[up], t_mature[up])
stacks = {k: [] for k in ("core_lit", "core_cover", "far_lit", "far_cover")}
stage_stats = []
in_window = (tr >= r0) & (tr < r0 + n) & (tc >= c0) & (tc < c0 + n)
for k in STAGE_KEYS:
    h_k = tree_height(hmax, birth, death, k)
    alive = meadow_tree & (birth < k) & (death > k) & (h_k >= 1.0)
    top, bot = top_up.copy(), bot_up.copy()
    stamp(top, bot, tr[alive], tc[alive], h_k[alive], np.where(h_k < SWITCH_H, t_young, t_mature)[alive])
    # Blurred widely, so a lone tree counts as light cover and a stand as full cover.
    cover = ndi.gaussian_filter((top - dem > 1.5).astype("f4"), 4.0)
    stacks["core_lit"].append(tree_light(dem[twin], top[twin], bot[twin], 1, shadow_reach)[tinner])
    stacks["core_cover"].append(cover[core])
    # At 4 m a cell is only partly crown, so its shadow is partial too.
    stacks["far_lit"].append(1 - 0.85 * (1 - tree_light(far_z, block_max(top), -block_max(-bot), fc, shadow_reach)))
    stacks["far_cover"].append(block(cover))
    seen = alive & in_window
    standing_dead = meadow_tree & in_window & (death <= k) & (death + 0.55 > k)
    stage_stats.append(f"stage {k}: {int(seen.sum()):6d} live meadow trees in the window, median {np.median(h_k[seen]) if seen.any() else 0:4.1f} m, "
                       f"tallest {h_k[seen].max() if seen.any() else 0:4.1f} m, {int(standing_dead.sum()):5d} standing dead, canopy cover {100 * cover[core].mean():3.0f}%")
    print(stage_stats[-1], flush=True)
for name, layers in stacks.items():
    level, what = name.split("_")
    save_stack(f"{level}_stage_{what}.webp", layers, 88 if what == "lit" else 80)

# ---- far level ---------------------------------------------------------
far_dists = geometric(fc, 4000, 1.05)
far_sun = horizon_tan(far_z, fc, args.sun_az, far_dists)
far_vis = sky_visibility(far_z, fc, geometric(fc, 600, 1.5))
far_filled = block(filled)
save_rgb("far_bake.png", deg45(far_sun), (far_vis - 0.5) / 0.5, block(inset_wet))
save_rgb("far_aux.png", block(road_soft), block(valid.astype("f4")), block(floor_wet))
save_rgb("far_site.png", block(hold), deg45(horizon_tan(far_filled, fc, args.sun_az, far_dists)),
         (sky_visibility(far_filled, fc, geometric(fc, 600, 1.5)) - 0.5) / 0.5)
save_rgb("far_cut.png", block(fill) / 4.0, block(arrive), block(np.minimum(bank_dist, 120)) / 120.0)
np.rint(block(arrive) * 65535).astype("<u2").tofile(os.path.join(OUT, "far_arrive.bin"))   # 8 bits would put the headcut on 4 m steps
save_rgb("far_thread.png", *[np.zeros((fh, fw), "f4")] * 3)   # no threads at 4 m
save_water("far", block)
np.rint((far_z - zmin) / zscale).astype("<u2").tofile(os.path.join(OUT, "far_h.bin"))
np.rint((block(healed) - zmin) / zscale).astype("<u2").tofile(os.path.join(OUT, "far_h_healed.bin"))

# ---- core level --------------------------------------------------------
# Near occluders at 1 m inside a padded window; distant ones from the far level.
pad = 400
pr0, pr1 = max(0, r0 - pad), min(H, r0 + n + pad)
pc0, pc1 = max(0, c0 - pad), min(W, c0 + n + pad)
padded = (slice(pr0, pr1), slice(pc0, pc1))
inner = (slice(r0 - pr0, r0 - pr0 + n), slice(c0 - pc0, c0 - pc0 + n))
# Dense steps: a sparse march turns a long shadow into a row of dots.
near_dists = list(range(1, 41)) + geometric(41, pad, 1.025)
rows = (np.arange(r0, r0 + n) + 0.5) / fc - 0.5
cols = (np.arange(c0, c0 + n) + 0.5) / fc - 0.5
grid = np.meshgrid(rows, cols, indexing="ij")
# Only occluders beyond the padded window come from the coarse level; nearer
# ones would repeat the 1 m result as soft blobs.
distant = ndi.map_coordinates(horizon_tan(far_z, fc, args.sun_az, geometric(pad, 4000, 1.05)), grid, order=1, mode="nearest")


def core_bake(surface):
    z = surface[padded]
    return (np.maximum(horizon_tan(z, 1, args.sun_az, near_dists)[inner], distant),
            sky_visibility(z, 1, geometric(1, 150, 1.5))[inner])


core_sun, core_vis = core_bake(dem)
filled_sun, filled_vis = core_bake(filled)
save_rgb("core_bake.png", deg45(core_sun), (core_vis - 0.5) / 0.5, inset_wet[core])
save_rgb("core_aux.png", road_soft[core], valid[core].astype("f4"), floor_wet[core])
save_rgb("core_site.png", hold[core], deg45(filled_sun), (filled_vis - 0.5) / 0.5)
save_rgb("core_cut.png", fill[core] / 4.0, arrive[core], np.minimum(bank_dist[core], 120) / 120.0)
np.rint(arrive[core] * 65535).astype("<u2").tofile(os.path.join(OUT, "core_arrive.bin"))
save_rgb("core_thread.png", *[0.5 + thread_sdf[core] / 8.0] * 3)
save_water("core", lambda a: a[core])
np.rint((dem[core] - zmin) / zscale).astype("<u2").tofile(os.path.join(OUT, "core_h.bin"))
np.rint((healed[core] - zmin) / zscale).astype("<u2").tofile(os.path.join(OUT, "core_h_healed.bin"))
for stale in ("core_veg.png", "far_veg.png"):
    if os.path.exists(os.path.join(OUT, stale)):
        os.remove(os.path.join(OUT, stale))

# ---- metadata ----------------------------------------------------------
gt = info["geoTransform"]
az, alt = np.radians(args.sun_az), np.radians(args.sun_alt)
meta = {
    "site": S,
    "crs": "EPSG:26910",
    "demOrigin": [gt[0], gt[3]],
    "zmin": zmin,
    "zscale": zscale,
    "core": {"col0": c0, "row0": r0, "size": n, "cell": 1},
    "far": {"width": fw, "height": fh, "cell": fc},
    "sun": {
        "azimuth": args.sun_az,
        "altitude": args.sun_alt,
        # world axes: x east, y up, z south
        "dir": [float(np.sin(az) * np.cos(alt)), float(np.sin(alt)), float(-np.cos(az) * np.cos(alt))],
    },
    "horizonMaxDeg": 45,
    "fillMax": 4.0,
    "stages": {"count": 7, "keys": STAGE_KEYS, "cut": [CUT_START, CUT_SPAN, CUT_TIME], "widen": [WIDEN_TIME, SLOT], "dry": [DRY_SPAN, DRY_WIDTH]},
    "channelDistMax": 120.0,
    "orbit": {"x": ox, "z": oz, "radius": ORBIT_R, "height": ORBIT_H, "start": ORBIT_START},   # metres from the core's north-west corner
    "landscape": landscape,
    "trees": {"count": int(tr.size), "bytes": trees.dtype.itemsize, "growSpan": GROW_SPAN, "growPow": GROW_POW, "switchHeight": SWITCH_H},
    "path": np.round(path, 2).tolist(),  # metres from the core's north-west corner
}
with open(os.path.join(OUT, "meta.json"), "w") as f:
    json.dump(meta, f)

for name in sorted(os.listdir(OUT)):
    print(f"{name:26s} {os.path.getsize(os.path.join(OUT, name)) / 1e6:6.2f} MB")
c_ = core
print(f"valley: channels cut below a terrace along {100 * (incision[chan & in_core] > 0.8).mean():.0f}% of their length in the window, "
      f"median {np.median(incision[chan & in_core & (incision > 0.8)]):.1f} m; fill {fill[c_].sum():.0f} m3, deepest {fill[c_].max():.1f} m")
print(f"zones in the window: meadow before incision {100 * (floor_wet[c_] > 0.5).mean():.0f}%, of which stays wet "
      f"{100 * ((floor_wet[c_] > 0.5) & ((inset_wet[c_] > 0.5) | (hold[c_] > 0.9))).mean():.0f}%, dries {100 * dries[c_].mean():.0f}%")
print(f"trees: {tr.size} ({int((~meadow_tree).sum())} upland, {int(meadow_tree.sum())} on the meadow); {int(in_window.sum())} in the window")
print(f"dead wood: {n_logs} logs in the window ({n_big_logs} large)")
moved = water[""][3][core] ^ water["_healed"][3][core]
print(f"water: {int(water[''][3][core].sum())} m of channel in the window; healing the roads moves {int(moved.sum())} m of it")
in_meadow = (floor_wet[c_] > 0.5)
print(f"threads: water on {100 * (thread_sdf[c_] > 0)[in_meadow].mean():.1f}% of the meadow before the capture; "
      f"orbit centre x {ox - n / 2:.0f}, z {oz - n / 2:.0f} (from the window's centre), fill there {fill[int(oz) + r0, int(ox) + c0]:.1f} m")
print(f"path: {len(path)} points, {s[-1]:.0f} m, {'joins' if joined else 'does NOT join'} the tributary")
