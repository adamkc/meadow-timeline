// Meadow and forest-floor plants in rings that travel with the camera: single
// blades underfoot, then cards showing plants out to the middle distance.
// Meadow grass and bunchgrass are scans (Poly Haven, CC0); sedge, rush and the
// Sierra Nevada wildflowers and ferns are built in tools/proc_plants.js. See
// tools/pack_plants.py for the atlas.
//
// Each plant keeps a fixed place in the world (its offset wraps around the
// ring) and reads the terrain textures there. Which plant it is follows the
// ground's moisture, which follows the timeline: a sedge and rush sward while
// the meadow is wet, meadow grass and corn lily as it dries, bunchgrass when it
// is dry, and nothing much under a closed canopy.
import * as THREE from 'three';
import { COMMON_GLSL } from './shaders.js';
import { ROSETTES, rosetteTexture } from './rosettes.js';

const MAX_PLANTS = 36;
// The sward: grasses and their like, which make up most of the meadow. Which
// one grows where follows the ground's moisture (see the vertex shader). Each
// has its own green, a factor on the meadow's colour where it grows: meadow
// grass light and yellowish, bunchgrass toward straw, sedge a plain mid green,
// rush dark and bluish.
const SWARD = { lush: [1.12, 1.1, 0.78], dry: [1.12, 1.0, 0.8], sedge: [0.9, 1.0, 0.95], rush: [0.66, 0.8, 0.8] };
// Wildflowers and understory plants of the Sierra Nevada, each where it grows:
//   wet     the moisture it wants, from .. to (1 saturated, 0 dry)
//   shade   the canopy cover it wants, from .. to (0 open, 1 closed)
//   perM2   plants per square metre where it grows best
//   drift   it grows in drifts: [which of four noise patterns, +1 where that is high or -1 low, how far into the tail]
//   flower, leaf   its colours as seen from the air; clump: its picture from above (rosettes.js) and that picture's width in metres
// Wet meadow first, then the plants of moist and drying ground, then the forest floor.
const FORBS = [
  { kind: 'camas',         wet: [0.72, 2], shade: [-1, 0.35], perM2: 1.6,  drift: [0, 1, 0.6],   flower: [0.2, 0.19, 0.78],   leaf: [0.1, 0.2, 0.06],   clump: [8, 1.2] },
  { kind: 'shootingstar',  wet: [0.66, 2], shade: [-1, 0.4],  perM2: 1.0,  drift: [1, 1, 0.62],  flower: [0.6, 0.07, 0.3],    leaf: [0.11, 0.21, 0.06], clump: [8, 0.9] },
  { kind: 'bistort',       wet: [0.55, 0.97], shade: [-1, 0.4], perM2: 0.9, drift: [0, -1, 0.62], flower: [0.52, 0.5, 0.47],  leaf: [0.1, 0.2, 0.06],   clump: [8, 1.0] },
  { kind: 'elephantshead', wet: [0.78, 2], shade: [-1, 0.3],  perM2: 0.6,  drift: [3, -1, 0.63], flower: [0.6, 0.16, 0.38],   leaf: [0.09, 0.17, 0.06], clump: [8, 0.8] },
  { kind: 'sneezeweed',    wet: [0.5, 0.9], shade: [-1, 0.4], perM2: 0.5,  drift: [2, 1, 0.62],  flower: [0.8, 0.55, 0.03],   leaf: [0.1, 0.2, 0.06],   clump: [8, 1.0] },
  { kind: 'lily',          wet: [0.28, 0.82], shade: [-1, 0.5], perM2: 0.5, drift: [1, -1, 0.55], flower: [0.7, 0.7, 0.6],    leaf: [0.15, 0.29, 0.1],  clump: [5, 1.5] },
  { kind: 'lupine',        wet: [0.4, 0.85], shade: [-1, 0.6], perM2: 0.3, drift: [3, 1, 0.6],   flower: [0.17, 0.14, 0.62],  leaf: [0.08, 0.19, 0.07], clump: [9, 1.3] },
  { kind: 'paintbrush',    wet: [0.3, 0.7], shade: [-1, 0.5], perM2: 0.35, drift: [2, -1, 0.62], flower: [0.75, 0.08, 0.02],  leaf: [0.1, 0.17, 0.06],  clump: [8, 0.8] },
  { kind: 'yarrow',        wet: [0.06, 0.45], shade: [-1, 0.45], perM2: 0.9, drift: [0, 1, 0.56], flower: [0.5, 0.49, 0.42],  leaf: [0.13, 0.19, 0.11], clump: [12, 1.0] },
  { kind: 'mulesears',     wet: [-1, 0.3], shade: [-1, 0.4],  perM2: 0.4,  drift: [1, -1, 0.57], flower: [0.85, 0.52, 0.03],  leaf: [0.2, 0.26, 0.16],  clump: [10, 1.3] },
  { kind: 'bracken',       wet: [0.02, 0.6], shade: [0.3, 2], perM2: 0.7,  drift: [2, 1, 0.5],   flower: [0, 0, 0],           leaf: [0.09, 0.22, 0.04], clump: [11, 2.2], shadeTolerant: true },
  { kind: 'snowplant',     wet: [-1, 0.4], shade: [0.55, 2],  perM2: 0.012, drift: [3, -1, 0.45], flower: [0.6, 0.02, 0.02], leaf: [0.5, 0.03, 0.03],  clump: [13, 0.35], shadeTolerant: true },
];
const KINDS = [...Object.keys(SWARD), ...FORBS.map((f) => f.kind)];
const FIRST_FORB = Object.keys(SWARD).length, LILY = KINDS.indexOf('lily');

const LEVEL_UNIFORMS = (p) => /* glsl */ `
uniform sampler2D u${p}Heights, u${p}Chan, u${p}Bake, u${p}Zone, u${p}Water, u${p}WaterHealed;
uniform sampler2DArray u${p}Stages;
uniform vec2 u${p}Origin, u${p}Extent, u${p}Res;
`;
const LEVEL_SAMPLE = (p) => /* glsl */ `{
  vec2 uv = (root - u${p}Origin) / u${p}Extent;
  float e = u${p}Extent.x / u${p}Res.x;
  vec2 ux = uv + vec2(e / u${p}Extent.x, 0.0), uz = uv + vec2(0.0, e / u${p}Extent.y);
  ground = fetchGround(u${p}Heights, uv, u${p}Res);
  chan = texture2D(u${p}Chan, uv);
  h = groundHeight(ground, chan);
  float hx = groundHeight(fetchGround(u${p}Heights, ux, u${p}Res), texture2D(u${p}Chan, ux));
  float hz = groundHeight(fetchGround(u${p}Heights, uz, u${p}Res), texture2D(u${p}Chan, uz));
  N = normalize(vec3(h - hx, e, h - hz));
  bake = texture2D(u${p}Bake, uv);
  zone = texture2D(u${p}Zone, uv);
  shade = treeShade(u${p}Stages, uv);
  vec2 flow;
  mainWater = waterAt(u${p}Water, u${p}WaterHealed, uv, incised(chan.r), flow);
}`;

const GRASS_VS = /* glsl */ `
${COMMON_GLSL}
${LEVEL_UNIFORMS('C')}
${LEVEL_UNIFORMS('F')}
uniform float uPatch;      // ring size in metres
uniform float uInner;      // plants closer than this are left to the finer ring
uniform float uWidth;
uniform float uHeight;
uniform float uRepeat;     // grass pictures across one card
uniform float uRoot;       // how dark the base of the plant is
uniform vec4 uPlantInfo[${MAX_PLANTS}]; // per picture: width and height in metres
uniform vec2 uKind[${KINDS.length}];    // per kind of plant: its first picture and how many it has
uniform vec2 uSpecial;     // 1 / (cards per square metre x pictures per card) in this ring; pictures per card for stand-alone plants
uniform vec2 uDetail;      // the share of this ring's plants being drawn; 1 / plants in the ring
uniform float uUse;        // 1 while this ring is in use, 0 when another has taken over (see createGrass)
uniform vec3 uKindTint[${KINDS.length}];  // each kind's own green, as a factor on the meadow's colour
uniform vec3 uRosette[${KINDS.length}];   // from the air: each kind's first picture of itself from above, how many, its width in metres
#define NFORB ${FORBS.length}
uniform vec4 uForbA[NFORB];   // the moisture it wants, from .. to; the canopy cover it wants, from .. to
uniform vec4 uForbB[NFORB];   // plants per m2 at best; which noise makes its drifts; +1 high or -1 low; how far into the tail
uniform vec4 uForbLeaf[NFORB];   // its leaves' colour from the air; 1 if it grows under a closed canopy
uniform vec3 uForbFlower[NFORB]; // its flowers' colour from the air
attribute vec2 aOff;
attribute vec4 aRnd;
varying vec3 vWorld;
varying vec3 vAlbedo;
varying vec3 vNormal;
varying vec3 vLight;       // shadow, sky visibility, height along the plant
varying vec4 vUv;          // cards: texture u (repeating), v, which picture, 1 for plants that keep their own colour
varying vec4 vAir;         // clumps seen from the air: the sun's direction across the picture, the wind's gust
varying vec3 vFlower;      // ... and the colour of its flowers

// 0 where a plant is about to change into another (its own number p is close
// to the threshold t that decides), 1 otherwise: it shrinks away as one thing
// and grows back as the other instead of switching in a frame.
float settled(float p, float t) {
  return smoothstep(0.0, 0.05 * min(1.0, 8.0 * t * (1.0 - t)) + 1e-4, abs(p - t));
}

void main() {
  vec2 cam = cameraPosition.xz;
  vec2 root = aOff + uPatch * floor((cam - aOff) / uPatch + 0.5);
  if (distance(root, cam) > 0.5 * uPatch) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float h, mainWater; vec3 N; vec4 ground, chan, bake, zone; vec2 shade;
  if (all(greaterThan(root, uCOrigin + 2.0)) && all(lessThan(root, uCOrigin + uCExtent - 2.0))) ${LEVEL_SAMPLE('C')}
  else ${LEVEL_SAMPLE('F')}

  // Rings are measured from the camera itself, not from the ground beneath it:
  // seen from the air the fine rings drop out and the meadow is one even sward,
  // not a denser disc that travels with the camera.
  float dist = length(vec3(root - cam, cameraPosition.y - h));
  float present = uUse * (1.0 - smoothstep(0.30, 0.5, dist / uPatch + aRnd.x * 0.12));
  if (uInner > 0.0) present *= smoothstep(uInner * 0.5, uInner * 1.5, dist + aRnd.z * uInner * 0.5);

  float arrive = chan.r;
  float trench = incised(arrive);               // how deep the channel has cut here
  float cut = removed(ground.a, arrive);        // how much of the fill is gone at this very spot
  float inWater = mainWater;
  // The meadow's small channels are open sand and water; plants stand back
  // from them. A clump seen from above is wide, so its middle stands back farther.
#ifdef AERIAL
  float channel = threadBed((chan.g - 0.5) * 8.0 + 0.5, arrive) * (1.0 - cut);
#else
  float channel = threadBed((chan.g - 0.5) * 8.0 + 0.15, arrive) * (1.0 - cut);
#endif
  float road = zone.a * (1.0 - uHeal);
  float cover = shade.y;
  float slope = 1.0 - N.y;
  float wet = moisture(zone.r, zone.g, zone.b, arrive);
  // Roads, steep ground, water and cobble bars, ground a failing bank has just
  // exposed, and canopy thin the plants one by one. Wet ground keeps its sward
  // even under trees.
  float density = step(0.5, chan.b) * (1.0 - smoothstep(0.25, 0.6, road)) * (1.0 - freshBank(ground.a, ground.b, arrive)) * (1.0 - headcut(ground.a, ground.b, arrive)) * (1.0 - channel)
                * (1.0 - 0.92 * smoothstep(0.09, 0.24, slope))
                * (1.0 - smoothstep(mix(-0.45, -0.7, trench), mix(0.0, -0.1, trench), inWater) * (1.0 - smoothstep(0.3, 0.7, road)));
  float canopy = 1.0 - 0.96 * smoothstep(0.3, 0.75, cover + 0.3 * (1.0 - smoothstep(0.05, 0.35, zone.r))) * (1.0 - smoothstep(0.5, 0.8, wet));
#ifdef TUFT
  // Which plant. First the wildflowers and understory plants: each wants its
  // own moisture and shade and grows in drifts, and a plant here is one of
  // them if its own number comes up. A plant close to becoming one, or to
  // ceasing to be one, is small: it shrinks away as one thing and grows back
  // as another.
  float m = wet + (fbm(root / 13.0 + 2.0) - 0.5) * 0.3;        // the ragged edge between communities comes from a slow noise
  vec4 drifts = vec4(texture2D(uNoise, (root / 23.0 + 3.0) / 16.0).rg, texture2D(uNoise, (root / 41.0 + 11.0) / 16.0).rg);
  int forb = -1;
  float change = 1.0;
  for (int i = 0; i < NFORB; i++) {
    if (forb >= 0) break;
    vec4 A = uForbA[i], B = uForbB[i];
    if (m < A.x - 0.07 || m > A.y + 0.07 || cover < A.z - 0.12 || cover > A.w + 0.12) continue; // not its kind of ground: most are not, anywhere
    float suits = smoothstep(A.x - 0.07, A.x + 0.07, m) * (1.0 - smoothstep(A.y - 0.07, A.y + 0.07, m))
                * smoothstep(A.z - 0.12, A.z + 0.12, cover) * (1.0 - smoothstep(A.w - 0.12, A.w + 0.12, cover));
    float p = min(1.0, B.x * uSpecial.x) * suits * smoothstep(B.w, B.w + 0.06, 0.5 + B.z * (drifts[int(B.y)] - 0.5));
    float mine = fract(aRnd.w * (29.3 + 17.71 * float(i)));
    change *= smoothstep(0.0, 0.1, abs(p - mine) / max(p, 1e-3));
    if (mine < p) forb = i;
  }
  if (forb >= 0 && uForbLeaf[forb].a > 0.5) canopy = 1.0;   // ferns and snow plant are at home under the trees
#endif
  density *= canopy;
  // Where grass is sparse it grows in clumps, not as lone blades.
  float chance = fract(aRnd.w * 7.31);
#ifndef TUFT
  chance = mix(chance, vnoise(root * 0.8), 0.8);
#endif
  // Plants come and go by growing and shrinking, never in a single frame:
  // at the edge of a ring, where the ground stops suiting them, and when a
  // slow machine draws fewer of them.
  float rank = (float(gl_InstanceID) + 0.5) * uDetail.y;
  float shown = present * smoothstep(-0.25 * density, 0.0, density - (0.03 + 0.97 * chance))
              * (1.0 - smoothstep(uDetail.x, uDetail.x + 0.1, rank));
  if (shown < 0.03) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float lush, patchy;
  vec3 tone = meadowColor(root, wet, lush, patchy);
  float height = uHeight * (0.5 + 0.8 * lush) * (0.55 + 0.9 * aRnd.y) * sqrt(shown);
  float t = position.y;
#ifdef TUFT
  // Otherwise it is part of the sward, by moisture.
  float pick = fract(aRnd.w * 91.7);
  float moist = smoothstep(0.22, 0.55, m), soaked = smoothstep(0.62, 0.9, m);
  int kind = 1;                                                   // dry bunchgrass
  if (pick < moist) kind = 0;                                     // meadow grass where it is moist
  if (pick < soaked) {                                            // a sedge sward where it is wet,
    kind = fbm2(root / 9.0 + 5.0) > 0.57 ? 3 : 2;                 // with rushes in patches
  }
  float special = 0.0;
  if (forb >= 0) { kind = ${FIRST_FORB} + forb; special = 1.0; }
  else change *= settled(pick, moist) * settled(pick, soaked);
  shown *= change;
  vec2 range = uKind[kind];
  float which = floor(fract(aRnd.w * 13.37) * range.y);
  // Corn lily: the last picture is a stem in flower. Few stems flower in any year.
  if (kind == ${LILY}) which = fract(aRnd.w * 37.1) < 0.02 ? range.y - 1.0 : floor(fract(aRnd.w * 13.37) * (range.y - 1.0));
  float picture = range.x + min(which, range.y - 1.0);
  vec4 info = uPlantInfo[int(picture + 0.5)];
  // Flowers stand a little above the sward they grow in, or they would not be seen (nor pollinated).
  float size = mix(0.75, 1.0, special) + 0.5 * aRnd.y;
  height = info.y * size * sqrt(shown) * mix(0.5 + 0.38 * lush, 1.0, special);
#endif

  // A gust field travelling down the valley, plus each plant's own flutter.
  vec2 wind = vec2(0.94, 0.34);
  float gust = snoise(root * 0.045 - wind * uTime * 0.6);
  float flutter = 0.05 * sin(uTime * 3.1 + aRnd.w * 40.0 + root.x * 0.7);
  float ang = aRnd.w * 6.2832;
  vec2 face = vec2(cos(ang), sin(ang)), across = vec2(-face.y, face.x);
  vec3 p = vec3(root.x, h, root.y);
  vAir = vec4(0.0);
  vFlower = vec3(0.0);
#ifdef AERIAL
  // Seen from the air: the clump from above, lying on the slope, turned any
  // way round. It does not follow the camera at all.
  vec3 rosette = uRosette[kind];
  // Clumps come in all sizes, and few are round.
  float span = rosette.z * (0.5 + 1.1 * aRnd.y * aRnd.y) * sqrt(shown), oval = 0.75 + 0.5 * aRnd.z;
  vec2 off = (face * position.x * oval + across * (position.y - 0.5) / oval) * span;
  p.xz += off;
  p.y += 0.3 * sqrt(shown) - dot(N.xz, off) / max(N.y, 0.4);
  vec2 sunXZ = normalize(uSunDir.xz);
  vUv = vec4(position.x + 0.5, position.y, rosette.x + floor(fract(aRnd.w * 13.37) * rosette.y), special);
  vAir = vec4(dot(face, sunXZ), dot(across, sunXZ), gust, 0.0);
  if (forb >= 0) vFlower = uForbFlower[forb];
#elif defined(TUFT)
  // Face the camera, each card turned from it by its own fixed angle (up to
  // about 55 degrees either way) so they are never seen edge-on and never all
  // parallel. The angle follows the camera smoothly; there is no direction at
  // which a card flips.
  vec2 toCam = normalize(cam - root + 1e-4);
  float turned = (fract(aRnd.w * 17.3) - 0.5) * 1.9;
  across = cos(turned) * vec2(-toCam.y, toCam.x) + sin(turned) * toCam;
  vec2 bend = wind * ((gust - 0.35) * 0.45 + flutter) * mix(1.0, 0.5, special);
  float repeat = mix(uRepeat, uSpecial.y, special);
  float width = info.x * repeat * mix(0.8 + 0.4 * aRnd.z, size, special) * mix(0.5, 1.0, shown);
  p.xz += across * width * position.x + bend * height * t;
  p.y += height * t - 0.03;
  vUv = vec4((position.x + 0.5) * repeat, t, picture, special);
#else
  vec2 bend = face * (0.15 + 0.4 * aRnd.x) + wind * ((gust - 0.35) * 0.7 + flutter);
  float width = uWidth * (0.7 + 0.6 * aRnd.z) * (1.0 + dist * 0.06);
  p.xz += across * width * position.x * (1.0 - 0.8 * t * t) + bend * height * t * t;
  p.y += height * t * (1.0 - 0.28 * t * dot(bend, bend));
  vUv = vec4(0.0);
#endif
  vWorld = p;

  vec3 col = tone * 1.05;
#ifdef TUFT
  // Each kind has its own green, and each plant strays a little from it, toward yellow or toward blue.
  col *= uKindTint[kind] * mix(vec3(1.1, 1.0, 0.84), vec3(0.9, 1.0, 1.12), fract(aRnd.w * 3.71));
#endif
#ifdef AERIAL
  t = 0.8;
  if (forb >= 0) col = uForbLeaf[forb].rgb * mix(vec3(1.08, 1.0, 0.88), vec3(0.92, 1.0, 1.1), fract(aRnd.w * 3.71));
  col *= 0.74 + 0.52 * aRnd.y;
#else
  col = mix(col, vec3(0.36, 0.33, 0.15), (1.0 - lush) * 0.25 * t); // straw tips where it is dry
  col *= (0.78 + 0.44 * aRnd.y) * mix(uRoot, 1.1, t);             // dark at the root
#endif
  vAlbedo = col;
  vNormal = normalize(N + vec3(face.x, 0.0, face.y) * 0.25);
  float vis = 0.5 + 0.5 * mix(bake.a, bake.g, cut);
  vLight = vec3(sunShadow(mix(bake.b, bake.r, cut)) * shade.x, vis * vis * (1.0 - 0.5 * cover), t);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const GRASS_FS = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D uPlants;
uniform float uGrid;         // pictures per side of the atlas
uniform vec3 uPlantTint[${MAX_PLANTS}]; // 1 / each picture's average colour
uniform sampler2D uRosettes; // clumps from above (rosettes.js)
uniform vec2 uRosetteGrid;
varying vec4 vAir;
varying vec3 vFlower;
varying vec3 vWorld;
varying vec3 vAlbedo;
varying vec3 vNormal;
varying vec3 vLight;
varying vec4 vUv;
void main() {
  vec3 albedo = vAlbedo;
  float alpha = 1.0;
#ifdef AERIAL
  float cell = floor(vUv.z + 0.5);
  vec2 uv = (vec2(mod(cell, uRosetteGrid.x), floor(cell / uRosetteGrid.x)) + clamp(vUv.xy, 0.004, 0.996)) / uRosetteGrid;
  vec2 plain = vUv.xy / uRosetteGrid, dx = dFdx(plain), dy = dFdy(plain);
  vec4 tex = textureGrad(uRosettes, uv, dx, dy);
  // Far off, the gaps between blades average into the picture; give the clump its body back.
  float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy)) * 1048576.0));
  alpha = smoothstep(0.1, 0.5, tex.a * (1.0 + 0.6 * lod));
  if (alpha < 0.08) discard;
  // A clump is a mound: its side toward the sun is lighter. Gusts turn the
  // blades and the meadow pales in waves.
  float side = 2.0 * dot(vUv.xy - 0.5, vAir.xy);
  albedo = vAlbedo * (0.5 + 0.8 * tex.r) * (1.0 + 0.2 * side) * (1.0 + 0.12 * (vAir.z - 0.35));
  albedo = mix(albedo, vFlower * (0.85 + 0.3 * tex.r), tex.g * vUv.w);
#elif defined(TUFT)
  // A wide card shows its picture several times, every other one mirrored.
  float u = fract(vUv.x);
  if (mod(floor(vUv.x), 2.0) > 0.5) u = 1.0 - u;
  float picture = floor(vUv.z + 0.5);
  vec2 cell = vec2(mod(picture, uGrid), floor(picture / uGrid));
  vec2 uv = (cell + vec2(clamp(u, 0.004, 0.996), 1.0 - clamp(vUv.y, 0.004, 0.996))) / uGrid;
  vec2 plain = vec2(vUv.x, -vUv.y) / uGrid, dx = dFdx(plain), dy = dFdy(plain);
  vec4 tex = textureGrad(uPlants, uv, dx, dy);
  // Blades thinner than a pixel average away in the small mipmaps; give
  // coverage back with distance so far grass thins into a haze, not to nothing.
  float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy)) * 6553600.0));
  alpha = smoothstep(0.1, 0.55, tex.a * (1.0 + 0.7 * lod));
  if (alpha < 0.08) discard;
  // The picture gives the blades their light and dark and some of their
  // colour; the hue comes mostly from the meadow, so wet ground reads green,
  // not grey. Flowers and corn lily keep their own colour.
  vec3 relative = min(tex.rgb * uPlantTint[int(picture)], vec3(2.2)); // about 1 on average
  relative = max(relative, vec3(0.42)); // dark seed heads and gaps would speckle the sward
  vec3 grass = vAlbedo * mix(vec3(dot(relative, vec3(0.3, 0.5, 0.2))), relative, 0.45);
  albedo = mix(grass, tex.rgb, vUv.w);
#endif
  vec3 rd = normalize(vWorld - cameraPosition);
  float t = vLight.z;
  float ndl = clamp((dot(normalize(vNormal), uSunDir) + 0.2) / 1.2, 0.0, 1.0);
  float through = pow(max(dot(rd, uSunDir), 0.0), 3.0); // blades glow when the sun is behind them
  float sun = mix(ndl, 0.6, 0.6) * (0.6 + 0.3 * t) + 0.3 * through * t;
  vec3 light = uSunColor * sun * vLight.x + mix(uGroundAmbient, uSkyAmbient, 0.8) * vLight.y * (0.55 + 0.45 * t);
  gl_FragColor = vec4(applyFog(albedo * light, vWorld), clamp(alpha, 0.0, 1.0));
}
`;

function instanced(geo, count, patch, seed) {
  const off = new Float32Array(count * 2), rnd = new Float32Array(count * 4);
  let state = seed;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return (state >>> 8) / 16777216; };
  for (let i = 0; i < count; i++) {
    off[i * 2] = rand() * patch; off[i * 2 + 1] = rand() * patch;
    rnd[i * 4] = rand(); rnd[i * 4 + 1] = rand(); rnd[i * 4 + 2] = rand(); rnd[i * 4 + 3] = rand();
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
  geo.instanceCount = count;
  return geo;
}
function bladeGeometry(segs) {
  const pos = [], idx = [];
  for (let s = 0; s < segs; s++) pos.push(-0.5, s / segs, 0, 0.5, s / segs, 0);
  pos.push(0, 1, 0);
  for (let s = 0; s < segs - 1; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  const a = (segs - 1) * 2;
  idx.push(a, a + 1, a + 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}
function tuftGeometry() {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  return geo;
}

export function createGrass({ levels, shared, scene, floatLinear, plants, quality = 1 }) {
  const [core, far] = levels;
  const levelUniforms = (p, l) => ({
    [`u${p}Heights`]: { value: l.heights }, [`u${p}Chan`]: { value: l.chan }, [`u${p}Bake`]: { value: l.bake },
    [`u${p}Zone`]: { value: l.zone }, [`u${p}Stages`]: { value: l.stages },
    [`u${p}Water`]: { value: l.water }, [`u${p}WaterHealed`]: { value: l.waterHealed },
    [`u${p}Origin`]: { value: l.origin }, [`u${p}Extent`]: { value: l.extent }, [`u${p}Res`]: { value: l.res },
  });
  const list = plants.index.plants;
  if (list.length > MAX_PLANTS) throw new Error(`plants.json has ${list.length} pictures; the shader holds ${MAX_PLANTS}`);
  const pad = (values, fill) => [...values, ...Array.from({ length: MAX_PLANTS - values.length }, fill)];
  const plantUniforms = {
    uPlants: { value: plants.texture }, uGrid: { value: plants.index.grid },
    uPlantInfo: { value: pad(list.map((p) => new THREE.Vector4(p.width, p.height, 0, 0)), () => new THREE.Vector4(1, 1, 0, 0)) },
    uPlantTint: { value: pad(list.map((p) => new THREE.Vector3(1 / p.mean[0], 1 / p.mean[1], 1 / p.mean[2])), () => new THREE.Vector3(1, 1, 1)) },
    // A kind with no pictures falls back to meadow grass.
    uKind: { value: KINDS.map((k) => {
      if (!plants.index.kinds[k]) throw new Error(`plants.json has no pictures of ${k}. Run tools/rebuild_assets.sh.`);
      return new THREE.Vector2(...plants.index.kinds[k]);
    }) },
    uKindTint: { value: KINDS.map((k) => new THREE.Vector3(...(SWARD[k] ?? [1, 1, 1]))) },
    uRosette: { value: [...Object.keys(SWARD).map((k) => new THREE.Vector3(...ROSETTES.sward[k])), ...FORBS.map((f) => new THREE.Vector3(f.clump[0], 1, f.clump[1]))] },
    uForbA: { value: FORBS.map((f) => new THREE.Vector4(...f.wet, ...f.shade)) },
    uForbB: { value: FORBS.map((f) => new THREE.Vector4(f.perM2, ...f.drift)) },
    uForbLeaf: { value: FORBS.map((f) => new THREE.Vector4(...f.leaf, f.shadeTolerant ? 1 : 0)) },
    uForbFlower: { value: FORBS.map((f) => new THREE.Vector3(...f.flower)) },
    uRosettes: { value: rosetteTexture() }, uRosetteGrid: { value: new THREE.Vector2(ROSETTES.cols, ROSETTES.rows) },
  };
  const meshes = [];
  const rings = [
    { patch: 22, count: 150000, width: 0.014, height: 0.46, inner: 0 },                 // blades
    { patch: 44, count: 110000, inner: 1.5, tuft: true, repeat: 1, alone: 1 },
    { patch: 130, count: 150000, inner: 14, tuft: true, repeat: 2, alone: 1 },
    // The outermost ring comes in two sizes. On foot the meadow is seen edge-on
    // and need not reach far. From the air a whole meadow is in view at once and
    // all of it has to lie inside the part of the ring where plants are full
    // size, or the far side would keep growing and shrinking as the camera circles.
    { patch: 420, count: 150000, inner: 45, tuft: true, repeat: 4, alone: 3, air: -1 },
    { patch: 760, count: 480000, inner: 45, tuft: true, aerial: true, alone: 1, air: 1 },
  ];
  rings.forEach((r, i) => {
    const count = Math.round(r.count * quality);
    if (count < 1000) return;
    const defines = {};
    if (floatLinear) defines.FLOAT_LINEAR = 1;
    if (r.tuft) defines.TUFT = 1;
    if (r.aerial) defines.AERIAL = 1;
    const perM2 = r.count / (r.patch * r.patch);
    const material = new THREE.ShaderMaterial({
      defines,
      uniforms: {
        ...shared, ...levelUniforms('C', core), ...levelUniforms('F', far), ...plantUniforms,
        uPatch: { value: r.patch }, uInner: { value: r.inner }, uWidth: { value: r.width ?? 1 }, uHeight: { value: r.height ?? 1 },
        uRepeat: { value: r.repeat ?? 1 }, uRoot: { value: r.tuft ? 0.8 : 0.3 },
        uSpecial: { value: new THREE.Vector2(1 / (perM2 * (r.alone ?? 1)), r.alone ?? 1) },
        uDetail: { value: new THREE.Vector2(2, 1 / count) }, uUse: { value: 1 },
      },
      vertexShader: GRASS_VS,
      fragmentShader: GRASS_FS,
      side: THREE.DoubleSide,
      alphaToCoverage: !!r.tuft,
    });
    const mesh = new THREE.Mesh(instanced(r.tuft ? tuftGeometry() : bladeGeometry(4), count, r.patch, 1234 + i * 77), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = i < 2 ? 0 : 3; // nearest rings first, far rings after the trees
    scene.add(mesh);
    meshes.push({ mesh, count, reach: 0.5 * r.patch, air: r.air ?? 0 });
  });
  return {
    // Plants are stored in random order, so drawing fewer thins the meadow
    // evenly; the last tenth drawn are on their way in or out (uDetail).
    setDetail(d) {
      for (const m of meshes) {
        m.mesh.material.uniforms.uDetail.value.x = d >= 1 ? 2 : d;
        m.mesh.geometry.instanceCount = Math.round(m.count * Math.min(1, d + 0.1));
      }
    },
    // `above` is the camera's height over the ground. A ring reaches half its
    // size from the camera, and one that cannot reach the ground is not drawn.
    // Between 15 and 35 m up, the outermost ring for walking hands over to the one for flying.
    update(above) {
      const air = Math.min(1, Math.max(0, (above - 15) / 20));
      for (const m of meshes) {
        const use = m.air > 0 ? air : m.air < 0 ? 1 - air : 1;
        m.mesh.material.uniforms.uUse.value = use * use * (3 - 2 * use);
        m.mesh.visible = use > 0 && above < 1.4 * m.reach;
      }
    },
  };
}
