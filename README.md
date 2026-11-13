# Meadow render

A browser scene on a real 1 m lidar DEM (Nye Meadow) that tells how a wet
meadow is lost, following the stream evolution models (Schumm's channel
evolution model; Cluer and Thorne's stage 0). The camera slowly circles one
meadow lobe while a timeline at the bottom of the page moves through seven
stages, blending smoothly between them. A landscape view flies out to show
every meadow in the valley going through the same change. Built toward a
"prerendered film, then step in" page. Plain three.js, no build step yet.

1. Wet meadow: water spreads through many small sandy channels; sedge and
   rush sward, willows along the channels, camas, shooting star and bistort
2. One channel cuts down: a headcut climbs the meadow, leaving a raw gully
   behind it; the small channels above it go dry
3. The trench widens: its banks fail and retreat, leaving a bare floor; the
   meadow is now a terrace, drying from its edges inward; the old channels are
   dry sand
4. Conifers move in: seedlings follow the drying front; corn lily, lupine and
   yarrow on ground that is still moist; the trench floor starts to green
5. Thickets: dense young pine on the dried ground, mule's ears in the openings
6. Closed stand: the thicket thins itself; snags, downed wood, litter
7. Mature forest: closed canopy over needle litter and bracken fern; wet
   meadow only inside the trench

**Live:** <https://adamcummings.net/meadow-timeline/> (a desktop browser with
WebGL 2; about 20 MB to load).

![The wet meadow at the start of the timeline](media/wet_meadow.jpg)

![The gully behind the headcut, and the small channels gone dry](media/headcut.jpg)

![Camas, bistort and willows along a channel in the wet meadow](media/flowers.jpg)

![Bracken fern on the floor of the mature forest](media/ferns.jpg)

![All seven stages from the circling view](media/stages.jpg)

![The landscape view: every meadow in the window, and the streams that join them](media/landscape.jpg)

**Not yet:** the film renderer, the hand-off page, the reimagine brushes.

## What is real and what is not

- **Measured:** today's terrain (the incised state), the road-healed terrain
  (ERASER inpainting), flow accumulation, the road mask.
- **Reconstructed by rule of thumb:** everything about the past and the plants.
  The pre-incision surface is today's with channels filled back to the level
  of the flat ground beside them, wherever such ground lies within 4 m above
  the channel. The meadow's small channels are routed across that surface from
  where water really enters each meadow to where it leaves, but their exact
  courses are generated. Where headcuts start and how fast they climb, meadow
  extent, moisture, which plants grow where, where trees and willows stand and
  when they grow and die are plausible, not surveyed. The timeline has no
  years on it.
- **The plants are those of a Sierra Nevada meadow** and the forest that
  replaces it, chosen for the story. They are not a survey of this site. The
  trees are generic scanned pines and firs, standing in for lodgepole pine
  (the usual invader of drying Sierra meadows) and the firs that follow it.
- **Roads** are left out of the story: the terrain shown is the road-healed
  one, and trees stand along the roads' lines. H shows today's roads and takes
  those trees away.

## Run

```bash
/usr/bin/python3 -m http.server 8137
```

Then open <http://localhost:8137>.

| Control | Action |
|---|---|
| Timeline track, stage names | drag or click to move through time |
| Play, Space | run the whole story, about ten seconds a stage |
| 1 to 7, F (Shift+F back) | jump to a stage |
| Landscape view, L | fly out to a high circle over all the valley's meadows, and back |
| H | show today's roads (and the surveyed terrain around them) |
| Drag | look around |
| Enter | step in and walk (W A S D, Shift to run, Esc to return to the circling view) |
| I | show which GPU is drawing the scene, the frame rate, resolution and plant density |

On a laptop with two GPUs, Chrome uses the integrated one unless Windows is
told otherwise (Settings > System > Display > Graphics > add Chrome > High
performance), and the scene then runs at about 0.6x resolution. Press I to see
which one is in use.

URL options: `&stage=0..6` (fractions allowed), `?u=0.3` (position around the
circle, paused, for stills), `&orbit=x,z` (circle another spot, metres from the
window's centre), `&radius=`, `&height=`, `&period=` (seconds per circuit),
`&view=landscape` (start in the landscape view), `&tour=stream` (fly down the
stream instead), `&yaw=`, `&pitch=`, `&at=x,z`
(stand at a point), `&look=x,z` (with `at`), `&walk=x,z,heading` (start on
foot), `&roads=1`, `&time=` (freezes
wind and water, with `u=`), `&fog=`, `&exposure=`, `&bloom=`, `&adapt=0`,
`&scale=` (fixed resolution, as rendered pixels per CSS pixel), `&maxscale=`,
`&blend=0` (no blending of frames over time), `&sharpen=`, `&grain=0`,
`&clear=` (metres the circling camera keeps above the treetops), `&info=1`
(start with the I readout showing), `&q=`, `&trees=0`, `&near=0`, `&logs=0`,
`&grass=0`, `&bench=1` (true frame cost).

## Rebuild the data

```bash
/usr/bin/python3 tools/prep_terrain.py     # terrain, zones, trees, logs, flight path: about 90 s
tools/rebuild_assets.sh                    # everything, including the plant and tree pictures: about 6 min
```

`prep_terrain.py` reads the DEMs, flow accumulation and road mask from the
parent repo, and writes compact files: 8-bit layers as lossless WebP, 16-bit
grids and the tree list gzipped (the page unpacks them itself, so the download
is the same size on any host). Options: `--site`, `--col0/--row0/--size` (the 1 m window),
`--sun-az/--sun-alt`, `--tree-spacing`, `--orbit` (centre of the camera's
circle), `--path-via` (a point the stream flight passes through). Use the system Python: the conda base has no numpy.

`rebuild_assets.sh` also downloads the Poly Haven models (cached in
`~/.cache/meadow_render`, about 2 GB, outside the repo; `raw` is a symlink to
it), renders trees, snags and plants to pictures in headless Chrome on the
discrete GPU, and packs them. It needs the local server running and stops at
the first step that fails. The sun is baked into the tree pictures: after
changing it, run `prep_terrain.py` once with the new values, then this script.

## Screenshots and tests

```bash
tools/shot.sh name="u=0.3&stage=2" cost="u=0.3&stage=4&bench=1"
tools/stages.sh orbit "u=0"                            # one view at all seven stages, plus a contact sheet
```

These drive headless Windows Chrome from WSL (one-time setup: `npm i
puppeteer-core` in `%TEMP%\meadow_tools`) and write to `shots/tmp` (`OUT=`
changes that). `SHOT_GPU=high` uses the discrete GPU. Only `bench=1` frame
times are real. `tools/timeline_test.mjs`, `tools/walk_test.mjs` and
`tools/live.mjs` (how resolution and plant density settle on a GPU), run with
Windows Node from that folder, exercise the timeline controls, walking and the
quality control.

Flicker cannot be seen in a still, so it is measured:

```bash
SHOT_GPU=high tools/flicker.sh run "stage=0"            # 8 places round the circle, 6 consecutive frames each
STAGE_FROM=0.4 tools/flicker.sh play "x=1"              # the same with the timeline playing
/usr/bin/python3 tools/flicker.py shots/tmp/flicker run play
```

`flicker.py` reports the share of pixels that go brighter then darker (or the
reverse) by at least 6 of 255 levels within three frames, which steady motion
rarely does, and writes a map of where. Add `&blend=0` to a run's query to see
the picture without blending over time.

## How it works

- **Timeline** (`shaders.js`, `main.js`): one number, the stage (0 to 6), drives
  everything. Shaders, the tree code and `prep_terrain.py` share the same rules
  (`incised`, `moisture`, `treeNow`).
- **Terrain** (`main.js`, `shaders.js`): a 1024 m window at 1 m and the whole
  DEM at 4 m. Height = road-healed + fill not yet removed - the meadow's small
  channels.
- **Drainage** (`prep_terrain.py`): every height in the valley model is
  measured above the channel the ground drains to, not the nearest channel as
  the crow flies (found by a least-climb search outward from the channels on a
  4 m grid). Measuring from the nearest gave the meadows straight seams where
  one channel's territory met another's. Outside the meadows each stream has a
  riparian strip, 3.5 to 11 m either side by drainage area, kept clear of
  conifers and planted with willows: that is what traces the drainage through
  the forest from the air.
- **The meadow's small channels** are routes over the pre-incision surface from
  each place water enters a meadow (the stream, a side drainage) to the
  meadow's outlet, so none starts or stops in the open. That surface is nearly
  level across the valley, so a route is the easiest way over ground made
  uneven at random; four such routings, and branches that leave one channel to
  rejoin lower down, make the network. Their beds are sand: under water until
  the headcut passes, then dry, and taken over by plants and litter only two
  to four stages later. Beyond the 1 m window the same routing is done on the
  4 m grid, so every meadow in the watershed has its channels, drawn a cell
  wide.
- **Channel evolution**: every incised reach (a run of channel with a terrace
  beside it; 17 in this watershed) gets a headcut, a step in the bed about 5 m
  long with white water on it, that enters at the reach's downstream end and
  climbs at 450 m of channel per stage or faster, so all the meadows are cut
  over the same stage. Behind it is a gully 7 m wide at the trench's full
  depth; then the banks retreat sideways, slowly at first, in bays and points,
  until today's trench is exposed. Gully and trench floor stay raw sediment
  for one to two and a half stages after the bank has passed, then green over
  from the channel outward: that is the new floodplain. The bank on the sun's
  side casts its shadow across the floor, worked out in the shader, since the
  baked shadows know only the surveyed trench. When the headcut arrives is
  stored at 12 bits (`*_arrive.bin.gz`): at 8 it would climb in jumps.
- **Moisture**: before the capture the whole meadow is wet. After, a drying
  front crosses it from the edges to the channel over about two stages, and
  only the low ground inside the trench stays wet. Channels with no terrace
  beside them are treated as not incised and keep their meadow.
- **Meadow plants** (`grass.js`, `rosettes.js`, `tools/pack_plants.py`,
  `tools/proc_plants.js`): rings of plants around the camera. The sward is
  chosen by moisture: sedge with patches of rush where saturated, meadow grass
  where moist, bunchgrass where dry. On foot they are upright cards: the two
  grasses from scans, everything else modelled in code and rendered to
  pictures the same way. From the air they are clumps seen from above, drawn
  in code and lying on the ground at any angle, because upright cards read as
  rows of strokes from up there. Each kind has its own green, each plant strays
  a little from it, and the meadow's base colour shifts in patches at two
  scales.
- **Wildflowers and understory** (the `FORBS` table in `grass.js`): fourteen
  species, each with the moisture and shade it wants, how thickly it grows and
  a drift pattern, so they come and go with the timeline. Wet meadow: common
  camas (*Camassia quamash*), water-plantain buttercup (*Ranunculus
  alismifolius*), Sierra shooting star (*Primula jeffreyi*), western bistort
  (*Bistorta bistortoides*), elephant's head (*Pedicularis groenlandica*),
  Bigelow's sneezeweed (*Helenium bigelovii*). Moist and drying ground: corn
  lily (*Veratrum californicum*), large-leaved lupine (*Lupinus polyphyllus*),
  giant red paintbrush (*Castilleja miniata*), yarrow (*Achillea
  millefolium*), woolly mule's ears (*Wyethia mollis*). Under and between the
  trees: pinemat manzanita (*Arctostaphylos nevadensis*), bracken fern
  (*Pteridium aquilinum*) and, rarely, snow plant (*Sarcodes sanguinea*). The
  wet-meadow species persist on the floodplain inside the trench. See "Plant
  sources" below for what each placement rests on.
- **Willows** (`tools/proc_plants.js`, `prep_terrain.py`): a shrub modelled in
  code and drawn as a picture from eight sides, like a distant tree. Thickets
  stand along the small channels from the start and die back as their ground
  dries; others come up on the raw floor of the trench soon after the banks
  have passed, and are the shrubs of the new floodplain.
- **Trees** (`trees.js`, `neartrees.js`, `prep_terrain.py`): each has a life:
  when it germinates, how tall it can grow, when it dies. Upland forest stands
  throughout. On the terrace a dense cohort germinates as the ground dries, so
  it follows the drying front in from the edges; most die as the stand closes (snags, then
  gone), about one in ten survives to make the mature forest, and firs come up
  underneath late on. Far trees are pictures of scanned trees from eight sides;
  within about 25 m they are real trunks and branches with sprig cards.
- **Tree shade**: baked at stages 3 to 7 and blended between them.
- **Water**: painted on the terrain. The small channels run over sand; the
  incised channel has a cobble bed and bars. Far off, a stream is drawn at
  least about a pixel wide so it does not break up.
- **Landscape view**: a second circle, about 530 m out and 640 m up, around
  the middle of the window's meadows, on the same bearing as the first; the
  camera flies between the two in six seconds. It looks down at about 50
  degrees, steep enough to see into the stream corridors. It is the real
  terrain with no vertical exaggeration: the whole lidar DEM of the watershed
  (4.2 by 2.8 km), streams where flow accumulation puts them. The last 220 m
  before the watershed boundary, where the data ends, dissolve into the sky.
- **Camera**: circles one meadow lobe every 170 seconds, so the whole sequence
  is watched in one place. Its height follows the ground and the tallest trees
  that ever stand near the path, 18 m clear of their tops, smoothed so it rises
  and sinks gently (about 53 to 78 m above the meadow). A tree close under the
  camera fills the frame, rushes through it, and is drawn as a mix of two
  versions of itself.
- **Dead wood** (`logs.js`): logs lie in the upland forest throughout and appear
  on the terrace as the thicket thins.
- **Post** (`post.js`): 4x multisampled HDR; each frame blended with the ones
  before it, reprojected through the depth buffer (temporal anti-aliasing),
  which is what keeps fine foliage from shimmering as the camera moves; bloom,
  exposure that adapts to the view, filmic tone curve, vignette, grain.
- **Quality** (`main.js`): resolution follows the GPU's measured time per
  frame. A strong GPU renders up to twice the screen's resolution and averages
  it down; a weak one drops to 0.62x, and then thins plants (each shrinking
  away, not vanishing) and shortens the range of 3D trees, to hold 30 fps.
- **Nothing pops**: plants grow and shrink at the edge of their ring, where the
  ground stops suiting them and where one kind gives way to another; tree
  pictures dissolve from one side view to the next; the outer plant ring is
  wide enough from the air that a whole meadow lies inside it.

## Plant sources

The species were chosen from published descriptions of Sierra Nevada meadows
and forests; where each grows in the scene is a rule of thumb built on them.

- Wet meadows: camas, bistort, water-plantain buttercup, shooting star,
  elephant's head, corn lily, lupine and paintbrush are named for Sierra wet
  meadows and stream banks by the
  [National Park Service's Yosemite wildflower guide](https://www.nps.gov/yose/learn/nature/wildflowerviewing.htm)
  and in [Wild Flowers of the Sierra](https://www.yosemite.ca.us/library/wild_flowers_of_the_sierra/meadows.html).
- Drying: lowered groundwater lets upland plants move onto meadow surfaces
  ([Landscape Ecology, 2023](https://link.springer.com/article/10.1007/s10980-023-01726-7));
  dry meadows carry bluegrass with forbs such as yarrow
  ([NRCS ecological site descriptions](https://edit.jornada.nmsu.edu/catalogs/esd/025X/R025XY004OR/model));
  lodgepole pine is the encroaching conifer
  ([Lubetkin, Westerling and Kueppers](https://escholarship.org/uc/item/5mz3w1wr)).
- Woolly mule's ears grows in open ground between trees, is common in the
  central and northern Sierra, forms solid patches after fire or clearing, and
  is displaced as brush and trees fill in
  ([Las Pilitas](https://www.laspilitas.com/nature-of-california/plants/wyethia-mollis);
  an informal source).
- Lodgepole stands have a sparse understory, with pinemat manzanita among the
  shrubs of their openings
  ([UC forestry notes](https://ucanr.edu/site/forest-research-and-outreach/lodgepole-pine-pinus-contorta)).
- Bracken is among the commonest ferns of Sierra woods and also grows in open
  meadows ([Ferns of the Sierra](https://www.yosemite.ca.us/library/ferns_of_the_sierra/pteridium.html));
  it marks seral forest and does not last past about 200 years
  ([Fire Effects Information System](https://www.fs.usda.gov/database/feis/plants/fern/pteaqu/all.html)),
  which the scene does not model: its bracken stays.
- Snow plant lives on a fungus that lives on conifer roots, so it comes up
  only under conifers
  ([Wikipedia](https://www.wikiwand.com/en/Sarcodes_sanguinea)).
- Not found in a source and placed on general knowledge: Bigelow's sneezeweed
  in moist meadow.

## Known gaps

- Motion has been measured (see flicker above) but not judged by eye from
  here. With blending over time, under 0.1% of pixels flicker per frame from
  the circling view (about 3% without); the cost is a slightly softer picture
  at 1x resolution and below, partly put back by sharpening.
- From the circling view the last stage is all canopy; the wet strip inside
  the trench shows through it only at stages 5 and 6.
- Headcuts start at the downstream end of every incised reach at once and
  climb at a set speed; nothing ties them to a real cause such as a road
  crossing. At the speed Play runs, one passes through the circled meadow in
  about five seconds.
- Willows are pictures at any distance, so they are soft seen from a few
  metres. They are kept off ground the trench will take, since a shrub cannot
  yet fall in with its bank.
- In the landscape view the meadows beyond the 1 m window are drawn from 4 m
  data: their small channels are 4 m wide, they have no thickets, and where a
  meadow straddles the window's edge its channels do not line up across it.
  Plants are not drawn that far out; the meadows are the ground's own colour.
- The flowers are all in bloom at once, at every stage: there are no seasons.
- Low evening sun puts the trench's east-facing banks, and the pockets behind
  them, in hard shadow. From the air these read as dark patches on the meadow.
- The pre-incision surface is a simple fill, and banks retreat by distance
  from the channel's centre line, made ragged by a fixed pattern rather than by
  any model of where banks fail. Where today's valley is confined (no
  terrace), the scene shows no change.
- Cut banks are steep faces of a 1 m height grid: textures stretch on them.
- A few lone trees stand in the wet meadow from the start, on small patches the
  zone rules count as upland.
- Trees grow by scaling, and switch from the sapling picture to the mature one
  at about 9.5 m; that switch can pop. Tree shade between baked stages is a
  blend, so shadows fade in rather than lengthen.
- The plants built in code are modelled from general knowledge of each
  species and from plant lists for Sierra Nevada meadows, not from specimens,
  and where each grows is a rule of thumb (see the `FORBS` table).
- Up close the needles are flat sprig pictures. Logs do not block walking.
- The DEM ends at the watershed boundary; beyond it there is only sky.
- At 1600x900 an RTX 4070 laptop GPU settles at 2x resolution and about 8 ms
  a frame. Intel UHD integrated graphics settles at 0.62x and about 32 fps,
  with plants thinned to about 70% in the open meadow; the ground shader is
  most of its cost. Not tested on a phone.
- The page loads about 20 MB before it shows anything, and another 4 MB (the
  full meshes for close-up trees) once it is running; until those arrive, a
  visitor who steps in at once sees nearby trees as flat pictures.

## Publishing

The site is this repository's `main` branch served by GitHub Pages from the
root (`.nojekyll` keeps Pages from processing it). Commit and push, and the
live page follows within a minute or two. `shots/` (working screenshots) and
`raw` (the downloaded models) are not in the repository.
