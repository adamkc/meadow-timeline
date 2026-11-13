#!/bin/bash
# Rebuild everything in data/ that comes from the scanned Poly Haven assets,
# then the terrain. Downloads are cached in ~/.cache/meadow_render (about 2 GB).
# Needs the local server running (python3 -m http.server 8137) for the bakes,
# and puppeteer-core in %TEMP%\meadow_tools (see README).
#
# Re-run after changing the sun (--sun-az/--sun-alt in prep_terrain.py: run that
# first so data/meta.json has the new sun), the tree models or the colour grades.
set -e -o pipefail   # stop at the first step that fails
cd "$(dirname "$0")/.."
PY=/usr/bin/python3
FIR_TINT="0.86,0.95,0.9"      # needle colour grades; the pine scan is brownish as delivered
PINE_TINT="0.74,1.08,0.78"

fetch() { $PY tools/fetch_assets.py "$@" | tail -1; }
bake() { # output name, query, asset, alpha map
  BAKE_NAME=$1 BAKE_QUERY=$2 tools/bake.sh "$3" "$4" | grep -E "rror|saved" | tail -1
}

echo "== download"
for m in fir_tree_01 pine_tree_01 fir_sapling_medium pine_sapling_medium grass_medium_01 grass_medium_02 dead_tree_trunk dead_tree_trunk_02; do fetch model $m 1k; done
for t in fir_tree_01 pine_tree_01 pine_sapling_medium; do fetch texture $t 1k twig_alpha; done
fetch texture fir_sapling_medium 1k twigs_alpha
for t in grass_medium_01 grass_medium_02; do fetch texture $t 1k Alpha; done
for t in forrest_ground_03 river_small_rocks dirt_floor; do fetch texture $t 1k diffuse; done

echo "== trees: eight views each, lit by this scene's sun"
bake fir_tree_01 "&tint=$FIR_TINT" fir_tree_01 fir_tree_01_twig_alpha_1k.jpg
bake pine_tree_01 "&tint=$PINE_TINT" pine_tree_01 pine_tree_01_twig_alpha_1k.jpg
bake fir_sapling_medium "&tint=$FIR_TINT" fir_sapling_medium fir_sapling_medium_twigs_alpha_1k.jpg
bake pine_sapling_medium "&tint=$PINE_TINT" pine_sapling_medium pine_sapling_medium_twig_alpha_1k.jpg
echo "== snags: the same trees without needles"
bake pine_tree_01_snag "&snag=1" pine_tree_01 pine_tree_01_twig_alpha_1k.jpg
bake pine_sapling_medium_snag "&snag=1" pine_sapling_medium pine_sapling_medium_twig_alpha_1k.jpg
bake fir_sapling_medium_snag "&snag=1" fir_sapling_medium fir_sapling_medium_twigs_alpha_1k.jpg
echo "== willow: built from scratch (tools/proc_plants.js), eight views like a tree; and its dead form"
bake willow "&proc=willow&made=2" proc
bake willow_snag "&proc=willow&made=2&snag=1" proc
echo "== meadow grasses (scans)"
GRASS="&cutout=all&views=2&cw=1024&ch=640"
bake plant_grass_lush "$GRASS&pick=large|mid|tall&scatter=14,0.7,0.3,1.5,2.4&variants=3" grass_medium_01 grass_medium_01_alpha_1k.jpg
bake plant_grass_dry "$GRASS&scatter=12,0.7,0.3,1.3,2.0&variants=2" grass_medium_02 grass_medium_02_alpha_1k.jpg
echo "== meadow plants built from scratch (tools/proc_plants.js)"
bake plant_cornlily "&proc=cornlily&made=6&views=2&cw=512&ch=1024" proc
bake plant_sedge "&proc=sedge&made=4&views=2&cw=1024&ch=640&scatter=5,0.7,0.28,0.85,1.2&variants=3" proc
bake plant_rush "&proc=rush&made=4&views=2&cw=1024&ch=640&scatter=4,0.7,0.28,0.85,1.2&variants=2" proc
echo "== Sierra Nevada wildflowers and understory plants, also built from scratch"
for sp in camas shootingstar bistort elephantshead sneezeweed lupine yarrow mulesears paintbrush bracken snowplant; do
  bake plant_$sp "&proc=$sp&made=3&views=2&cw=640&ch=640" proc
done

echo "== pack"
$PY tools/pack_cards.py | tail -2
$PY tools/build_near_trees.py | tail -1
$PY tools/pack_plants.py | tail -1
$PY tools/pack_ground.py | tail -1
(cd tools && $PY build_logs.py | tail -1)
echo "== terrain (reads the tree cards to shape the shadows, so it goes last)"
$PY tools/prep_terrain.py | tail -11
