import * as THREE from 'three';
import { SKY_VS, SKY_FS, TERRAIN_VS, TERRAIN_FS } from './shaders.js';
import { createTrees } from './trees.js';
import { createGrass } from './grass.js';
import { createLogs } from './logs.js';
import { createWildlife } from './wildlife.js';
import { createSound } from './sound.js';
import { createGuide } from './guide.js';
import { createPost } from './post.js';
import { noiseTexture } from './noise.js';

const DATA = './data/';
const params = new URLSearchParams(location.search);
const num = (name, fallback) => (params.has(name) ? Number(params.get(name)) : fallback);
const hud = document.getElementById('hud');
const veil = document.getElementById('veil');

function fail(message) {
  const el = document.getElementById('error');
  el.textContent = message;
  el.style.display = 'grid';
  veil.style.opacity = 0;
  throw new Error(message);
}

// ---- renderer -----------------------------------------------------------
const canvas = document.getElementById('view');
let renderer;
try {
  // No antialiasing here: the scene is drawn into a multisampled buffer in post.js.
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  fail('This scene needs WebGL 2, which this browser or device did not provide.');
}
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exposure', 0.62);
const floatLinear = renderer.extensions.has('OES_texture_float_linear');
const quality = num('q', 1); // scales grass density and tree detail distance

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 55), 1, 0.25, 20000);
const ditherShift = { value: 0 };
const sunDir = new THREE.Vector3(0, 1, 0), sunColor = new THREE.Color(3.3, 2.5, 1.55); // the direction is set once the data is loaded
const post = createPost(renderer, { bloom: num('bloom', 0.07), adapt: num('adapt', 1), grain: num('grain', 1), blend: num('blend', 0.9), sharpen: num('sharpen', 0.5),
  shafts: num('shafts', 0.5), sunDir, sunColor, ditherShift });

// ---- data ---------------------------------------------------------------
const loading = { asked: 0, done: 0 };
async function get(name) {
  loading.asked++;
  const r = await fetch(DATA + name);
  if (!loading.shown) veil.textContent = `Loading the meadow… ${++loading.done} of ${Math.max(loading.asked, 46)} files`;
  if (!r.ok) fail(`Could not load ${name} (${r.status}). Run tools/prep_terrain.py first.`);
  return r;
}
// A file that was gzipped when it was built (tools/prep_terrain.py, save_gz).
// If the server has already unpacked it on the way, it is used as it comes.
async function unpacked(name) {
  const bytes = new Uint8Array(await (await get(name)).arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
// A 16-bit grid stored as each sample's difference from the one to its left.
async function getGrid16(name, w, h) {
  const d = new Uint16Array(await unpacked(name));
  if (d.length !== w * h) fail(`${name} has ${d.length} samples, expected ${w * h}. Re-run tools/prep_terrain.py.`);
  for (let y = 0, i = 0; y < h; y++) { i++; for (let x = 1; x < w; x++, i++) d[i] += d[i - 1]; }
  return d;
}
// An image as raw RGBA bytes, for data that is needed on the CPU or repacked.
async function pixels(name) {
  const bitmap = await createImageBitmap(await (await get(name)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  return { width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
}
const loader = new THREE.TextureLoader();
async function dataImage(name) {
  const t = await loader.loadAsync(DATA + name).catch(() => fail(`Could not load ${name}. Run tools/prep_terrain.py first.`));
  t.flipY = false; // row 0 is north, same as the height arrays
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const meta = await (await get('meta.json')).json();
const N = meta.core.size;
const FW = meta.far.width, FH = meta.far.height, FC = meta.far.cell;

// One level of terrain. The files (see tools/prep_terrain.py) are repacked
// into the textures the shaders use; heights and the channel data are kept on
// the CPU too, for the camera.
function bytesTexture(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
async function loadLevel(name, w, h) {
  const [heightsIn, healedBy, arriveIn, cut, thread, bakeIn, aux, site, lit, cover, water, waterHealed] = await Promise.all([
    getGrid16(`${name}_h.bin.gz`, w, h), unpacked(`${name}_dh.bin.gz`).then((b) => new Int16Array(b)),
    getGrid16(`${name}_arrive.bin.gz`, w, h),
    pixels(`${name}_cut.webp`), pixels(`${name}_thread.webp`), pixels(`${name}_bake.webp`), pixels(`${name}_aux.webp`), pixels(`${name}_site.webp`),
    pixels(`${name}_stage_lit.webp`), pixels(`${name}_stage_cover.webp`),
    dataImage(`${name}_water.webp`), dataImage(`${name}_water_healed.webp`),
  ]);
  const count = w * h;
  if (healedBy.length !== count) fail(`${name}_dh.bin.gz has ${healedBy.length} samples, expected ${count}. Re-run tools/prep_terrain.py.`);
  const surveyed = new Float32Array(count), healed = new Float32Array(count); // metres above meta.zmin
  for (let i = 0; i < count; i++) { surveyed[i] = heightsIn[i] * meta.zscale; healed[i] = (heightsIn[i] + healedBy[i]) * meta.zscale; }
  const fill = new Float32Array(count), dist = new Float32Array(count), arrive = new Float32Array(count), threads = new Float32Array(count);
  // The channel texture holds half floats: when the headcut arrives needs far
  // more than 8 bits, or the headcut would climb the channel in jumps.
  const packed = new Float32Array(count * 4), chan = new Uint16Array(count * 4), bake = new Uint8Array(count * 4), zone = new Uint8Array(count * 4);
  const halfOfByte = Uint16Array.from({ length: 256 }, (_, v) => THREE.DataUtils.toHalfFloat(v / 255));
  for (let i = 0, k = 0; i < count; i++, k += 4) {
    fill[i] = cut.data[k] / 255 * meta.fillMax;
    arrive[i] = arriveIn[i] / 65520;
    dist[i] = cut.data[k + 2] / 255 * meta.channelDistMax;
    threads[i] = (thread.data[k] / 255 - 0.5) * 8;                                     // metres inside a thread's edge
    packed[k] = surveyed[i]; packed[k + 1] = healed[i] - surveyed[i]; packed[k + 2] = fill[i]; packed[k + 3] = dist[i];
    chan[k] = THREE.DataUtils.toHalfFloat(arrive[i]); chan[k + 1] = halfOfByte[thread.data[k]]; chan[k + 2] = halfOfByte[aux.data[k + 1]]; chan[k + 3] = halfOfByte[cut.data[k + 1]]; // alpha: 0 at the edge of the data, 1 well inside
    bake[k] = bakeIn.data[k]; bake[k + 1] = bakeIn.data[k + 1]; bake[k + 2] = site.data[k + 1]; bake[k + 3] = site.data[k + 2];
    zone[k] = aux.data[k + 2]; zone[k + 1] = bakeIn.data[k + 2]; zone[k + 2] = site.data[k]; zone[k + 3] = aux.data[k];
  }
  const heights = new THREE.DataTexture(packed, w, h, THREE.RGBAFormat, THREE.FloatType);
  heights.minFilter = heights.magFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
  heights.needsUpdate = true;
  // Tree shade: one layer per key stage, r sunlight past the trees, g canopy cover.
  const layers = meta.stages.keys.length;
  if (lit.height !== h * layers || cover.height !== h * layers) fail(`${name}_stage_*.webp do not hold ${layers} stages. Re-run tools/prep_terrain.py.`);
  const rg = new Uint8Array(count * layers * 2);
  for (let i = 0; i < count * layers; i++) { rg[i * 2] = lit.data[i * 4]; rg[i * 2 + 1] = cover.data[i * 4]; }
  const stages = new THREE.DataArrayTexture(rg, w, h, layers);
  stages.format = THREE.RGFormat;
  stages.minFilter = stages.magFilter = THREE.LinearFilter;
  stages.unpackAlignment = 1; // rows of two-byte texels need not be a multiple of four bytes long
  stages.needsUpdate = true;
  const chanTexture = new THREE.DataTexture(chan, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  chanTexture.minFilter = chanTexture.magFilter = THREE.LinearFilter;
  chanTexture.needsUpdate = true;
  return { surveyed, healed, fill, dist, arrive, threads, cover: rg, heights, chan: chanTexture, bake: bytesTexture(bake, w, h),
    zone: bytesTexture(zone, w, h), stages, water, waterHealed, w, h };
}
// The trees come a column at a time, positions as differences from the tree
// before (tools/prep_terrain.py); the rest of the scene wants 12-byte records.
async function getTrees() {
  // Stored per tree: x and z (2 bytes each), then one byte each of full height,
  // germination, death, and its sapling, grown and dead pictures, and whether it
  // stands on a road's line. Its seed (byte 7 of the record) is made here.
  const packed = new Uint8Array(await unpacked('trees.bin.gz')), REC = meta.trees.bytes, n = packed.length / 11;
  if (!Number.isInteger(n) || REC !== 12) fail('trees.bin.gz is not a whole number of trees. Re-run tools/prep_terrain.py.');
  const out = new DataView(new ArrayBuffer(n * REC)), xz = new Uint16Array(packed.buffer, 0, 2 * n);
  const FROM = [4, 5, 6, 8, 9, 10, 11]; // where each stored byte goes in the record
  let x = 0, z = 0;
  for (let i = 0; i < n; i++) {
    x = (x + xz[i]) & 65535; z = (z + xz[n + i]) & 65535;
    out.setUint16(i * REC, x, true); out.setUint16(i * REC + 2, z, true);
    for (let k = 0; k < 7; k++) out.setUint8(i * REC + FROM[k], packed[(4 + k) * n + i]);
    out.setUint8(i * REC + 7, (Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 13 & 255);
  }
  return out.buffer;
}
const [coreData, farData, treeBuffer] = await Promise.all([
  loadLevel('core', N, N), loadLevel('far', FW, FH), getTrees(),
]);

// World frame: x east, y up (metres above zmin), z south; origin at the
// centre of the core window.
const coreOrigin = new THREE.Vector2(-N / 2, -N / 2);
const farOrigin = new THREE.Vector2(-meta.core.col0 - N / 2, -meta.core.row0 - N / 2);
const core = { ...coreData, origin: coreOrigin, extent: new THREE.Vector2(N, N), res: new THREE.Vector2(N, N), cell: 1 };
const far = { ...farData, origin: farOrigin, extent: new THREE.Vector2(FW * FC, FH * FC), res: new THREE.Vector2(FW, FH), cell: FC, isFar: true };

// ---- shared uniforms ---------------------------------------------------------
const shared = {
  uSunDir: { value: sunDir.set(...meta.sun.dir).normalize() },
  uSunAltDeg: { value: meta.sun.altitude },
  uHorizonMaxDeg: { value: meta.horizonMaxDeg },
  uSunColor: { value: sunColor },
  uSkyAmbient: { value: new THREE.Color(0.74, 0.98, 1.46) },
  uGroundAmbient: { value: new THREE.Color(0.44, 0.36, 0.24) },
  uFogDensity: { value: num('fog', 0.0005) },
  uFogFalloff: { value: 1 / 160 },
  uFogBase: { value: 0 },
  uHeal: { value: 1 },   // roads are left out unless asked for (H)
  uStage: { value: 0 },
  uCut: { value: new THREE.Vector3(...meta.stages.cut) },
  uWiden: { value: new THREE.Vector2(...meta.stages.widen) },
  uDry: { value: new THREE.Vector2(...meta.stages.dry) },
  uKeys: { value: new THREE.Vector2(meta.stages.keys[0], meta.stages.keys.length - 1) },
  uGrow: { value: new THREE.Vector3(meta.trees.growSpan, meta.trees.growPow, meta.trees.switchHeight) },
  uTime: { value: 0 },
  uWide: { value: 0 },
  uDitherShift: ditherShift,
  uNoise: { value: noiseTexture() },
  uCoreRect: { value: new THREE.Vector4(coreOrigin.x, coreOrigin.y, coreOrigin.x + N, coreOrigin.y + N) },
};

// ---- ground height on the CPU (camera, tile bounds, tree bases) ---------------
function bilinear(data, w, h, fx, fy) {
  const x = Math.min(Math.max(fx - 0.5, 0), w - 1.001), y = Math.min(Math.max(fy - 0.5, 0), h - 1.001);
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, k = j * w + i;
  return (data[k] * (1 - u) + data[k + 1] * u) * (1 - v) + (data[k + w] * (1 - u) + data[k + w + 1] * u) * v;
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// The same rules as in shaders.js (cutStart, removed, threadCarve).
const CUT = meta.stages.cut, WIDEN = meta.stages.widen;
function removedAt(d, arrive) {
  const t = shared.uStage.value, t0 = CUT[0] + CUT[1] * arrive;
  const q = Math.min(1, Math.max(0, (t - t0 - 0.7 * CUT[2]) / WIDEN[0]));
  const w = WIDEN[1] + (80 - WIDEN[1]) * q * q;
  return smoothstep(t0, t0 + CUT[2], t) * (1 - smoothstep(w, w + 1.6, d));
}
function threadCarve(sdf, arrive) {
  const t0 = CUT[0] + CUT[1] * arrive;
  return 0.3 * smoothstep(-1.8, 0.5, sdf) * (1 - smoothstep(t0 + 2.5, t0 + 5.0, shared.uStage.value));
}
// Height of the ground now. `rooted` gives the ground as it ends up, with no
// fill and no meadow channels: what trees and logs stand on.
function groundAt(x, z, rooted = false) {
  const cx = x - coreOrigin.x, cz = z - coreOrigin.y;
  const L = cx >= 0 && cx <= N && cz >= 0 && cz <= N ? core : far;
  const fx = (x - L.origin.x) / L.cell, fz = (z - L.origin.y) / L.cell;
  const s = bilinear(L.surveyed, L.w, L.h, fx, fz);
  let y = s + (shared.uHeal.value > 0 ? (bilinear(L.healed, L.w, L.h, fx, fz) - s) * shared.uHeal.value : 0);
  if (!rooted) {
    const arrive = bilinear(L.arrive, L.w, L.h, fx, fz);
    y += (1 - removedAt(bilinear(L.dist, L.w, L.h, fx, fz), arrive))
       * (bilinear(L.fill, L.w, L.h, fx, fz) - threadCarve(bilinear(L.threads, L.w, L.h, fx, fz), arrive));
  }
  return y;
}
const rootedAt = (x, z) => groundAt(x, z, true);

// ---- scanned ground textures ---------------------------------------------------
const groundIndex = await (await get('ground.json')).json();
const groundUniforms = {};
await Promise.all(Object.entries(groundIndex).map(async ([name, g]) => {
  const t = await loader.loadAsync(DATA + g.file).catch(() => fail(`Could not load ${g.file}. Run tools/pack_ground.py first.`));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  const key = name[0].toUpperCase() + name.slice(1);
  groundUniforms[`u${key}`] = { value: t };
  groundUniforms[`u${key}Info`] = { value: new THREE.Vector4(1 / g.mean[0], 1 / g.mean[1], 1 / g.mean[2], 1 / g.size) };
}));

// ---- sky ------------------------------------------------------------------------
const sky = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1, 3),
  new THREE.ShaderMaterial({ uniforms: shared, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false }),
);
sky.frustumCulled = false;
sky.renderOrder = 10; // after everything else, so hidden sky pixels are skipped
scene.add(sky);

// ---- terrain tiles ------------------------------------------------------------
function terrainMaterial(level) {
  const defines = {};
  if (floatLinear) defines.FLOAT_LINEAR = 1;
  if (level.isFar) defines.IS_FAR = 1;
  return new THREE.ShaderMaterial({
    defines,
    uniforms: {
      ...shared, ...groundUniforms,
      uHeights: { value: level.heights }, uChan: { value: level.chan }, uBake: { value: level.bake },
      uZone: { value: level.zone }, uStages: { value: level.stages },
      uWater: { value: level.water }, uWaterHealed: { value: level.waterHealed },
      uOrigin: { value: level.origin }, uExtent: { value: level.extent }, uRes: { value: level.res },
    },
    vertexShader: TERRAIN_VS,
    fragmentShader: TERRAIN_FS,
    side: THREE.DoubleSide,
  });
}

// A unit grid of `segs` cells plus a ring of skirt vertices that hang below
// the edge and hide cracks between tiles of different density.
function gridGeometry(segs) {
  const m = segs + 3;
  const pos = new Float32Array(m * m * 3), skirt = new Float32Array(m * m);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const k = j * m + i;
      pos[k * 3] = Math.min(Math.max(i - 1, 0), segs) / segs;
      pos[k * 3 + 2] = Math.min(Math.max(j - 1, 0), segs) / segs;
      skirt[k] = i === 0 || j === 0 || i === m - 1 || j === m - 1 ? 1 : 0;
    }
  }
  const idx = new Uint16Array((m - 1) * (m - 1) * 6);
  let n = 0;
  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < m - 1; i++) {
      const a = j * m + i, b = a + 1, c = a + m, d = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = b; idx[n++] = c; idx[n++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('skirt', new THREE.BufferAttribute(skirt, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
const grids = { 64: gridGeometry(64), 32: gridGeometry(32), 16: gridGeometry(16), 8: gridGeometry(8) };

const tiles = [];
function addTiles({ material, origin, cols, rows, tileSize, lods, range, skip }) {
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = origin.x + tx * tileSize, z0 = origin.y + ty * tileSize;
      if (skip?.(x0, z0)) continue;
      const [lo, hi] = range(x0, z0, tileSize);
      if (lo > hi) continue;
      const mesh = new THREE.Mesh(grids[lods[0][1]], material);
      mesh.position.set(x0, 0, z0);
      mesh.scale.set(tileSize, 1, tileSize);
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false; // culled below against the real height range
      mesh.renderOrder = 5;       // after trees and grass, which hide much of it
      scene.add(mesh);
      const box = new THREE.Box3(new THREE.Vector3(x0, lo - 2, z0), new THREE.Vector3(x0 + tileSize, hi + 2, z0 + tileSize));
      tiles.push({ mesh, box, lods });
    }
  }
}
// Lowest and highest the ground can be in a tile, over every state of the timeline.
function rangeIn(L) {
  const { surveyed: data, healed: also, fill, w, h, cell, origin } = L;
  return (x0, z0, size) => {
    const i0 = Math.max(0, Math.floor((x0 - origin.x) / cell) - 1), i1 = Math.min(w - 1, Math.ceil((x0 + size - origin.x) / cell) + 1);
    const j0 = Math.max(0, Math.floor((z0 - origin.y) / cell) - 1), j1 = Math.min(h - 1, Math.ceil((z0 + size - origin.y) / cell) + 1);
    let lo = Infinity, hi = -Infinity;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const v = data[j * w + i], u = also[j * w + i];
        lo = Math.min(lo, v, u) - 0.3; // the meadow's small channels lie a little below it
        hi = Math.max(hi, v, u + fill[j * w + i]);
      }
    }
    return [lo, hi];
  };
}

const CORE_TILE = 64, FAR_TILE = 256;
addTiles({
  material: terrainMaterial(core),
  origin: coreOrigin, cols: N / CORE_TILE, rows: N / CORE_TILE, tileSize: CORE_TILE,
  lods: [[110, 64], [280, 32], [650, 16], [Infinity, 8]],
  range: rangeIn(core),
});
addTiles({
  material: terrainMaterial(far),
  origin: farOrigin, cols: Math.ceil(FW * FC / FAR_TILE), rows: Math.ceil(FH * FC / FAR_TILE), tileSize: FAR_TILE,
  lods: [[1100, 64], [2400, 32], [Infinity, 16]],
  range: rangeIn(far),
  // Far tiles wholly under the core window are never seen.
  skip: (x0, z0) => x0 >= coreOrigin.x && z0 >= coreOrigin.y && x0 + FAR_TILE <= coreOrigin.x + N && z0 + FAR_TILE <= coreOrigin.y + N,
});

const frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4();
function updateTiles() {
  viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj);
  for (const t of tiles) {
    t.mesh.visible = frustum.intersectsBox(t.box);
    if (!t.mesh.visible) continue;
    const d = t.box.distanceToPoint(camera.position);
    t.mesh.geometry = grids[t.lods.find(([limit]) => d < limit)[1]];
  }
}

// ---- vegetation -----------------------------------------------------------------
async function cardTexture(name, colorSpace) {
  const t = await loader.loadAsync(DATA + name).catch(() => fail(`Could not load ${name}. Run tools/pack_cards.py first.`));
  t.flipY = false;
  t.colorSpace = colorSpace;
  t.anisotropy = 4;
  return t; // mipmapped, straight alpha
}
let trees = null, cardIndex = null, plantIndex = null; // the atlases' indexes are kept for the field guide's pictures
if (params.get('trees') !== '0') {
  const [cards, cardA, cardB] = await Promise.all([
    get('cards.json').then((r) => r.json()),
    cardTexture('cards_a.webp', THREE.SRGBColorSpace), cardTexture('cards_b.webp', THREE.NoColorSpace),
  ]);
  cardIndex = cards;
  trees = createTrees({ buffer: treeBuffer, life: meta.trees, cards, cardA, cardB, levels: [core, far], farOrigin, shared, groundAt: rootedAt, scene, quality });
}
// The full trees for close range (trunks, branches, sprigs: about 4 MB) are only
// needed on foot, so they are fetched once the scene is running. Until they
// arrive, and with ?near=0 for good, every tree is a card. A fixed frame (?u=)
// waits for them, so that screenshots do not depend on timing.
async function loadNearTrees() {
  const index = await fetch(DATA + 'near_trees.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!index) return;
  const colour = async (name) => {
    const t = await cardTexture(name, THREE.SRGBColorSpace);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const atlases = [...new Set(index.trees.map((t) => t.atlas))];
  const [buffer, woodTextures, sprigs] = await Promise.all([
    unpacked('near_trees.bin.gz'),
    Promise.all(index.wood.map(colour)), Promise.all(atlases.map(colour)),
  ]);
  trees.attachNear({ index, buffer, woodTextures, sprigTextures: Object.fromEntries(atlases.map((a, i) => [a, sprigs[i]])) });
}
if (trees && params.get('near') !== '0') {
  const wait = params.has('u') || params.has('walk'); // a still, or starting on foot among the trees
  const loaded = loadNearTrees().catch((e) => console.warn('The close-range trees did not load; trees stay as pictures.', e));
  if (wait) await loaded;
}
let grass = null;
if (params.get('grass') !== '0') {
  const [index, texture] = await Promise.all([
    get('plants.json').then((r) => r.json()),
    loader.loadAsync(DATA + 'plants.webp').catch(() => fail('Could not load plants.webp. Run tools/pack_plants.py first.')),
  ]);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  plantIndex = index;
  grass = createGrass({ levels: [core, far], shared, scene, floatLinear, plants: { index, texture }, quality });
}

// Downed logs: optional, like the near trees.
let logs = null;
if (params.get('logs') !== '0' && trees) {
  const index = await fetch(DATA + 'logs.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (index) {
    const [buffer, places, textures] = await Promise.all([
      get('logs.bin').then((r) => r.arrayBuffer()), get('log_places.bin').then((r) => r.arrayBuffer()),
      Promise.all(index.models.map((m) => loader.loadAsync(DATA + m.texture).then((t) => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }))),
    ]);
    logs = createLogs({ index, buffer, textures, places, core, coreCorner: coreOrigin, shared, groundAt: rootedAt, scene });
  }
}

// ---- the tour ----------------------------------------------------------------
// (Butterflies, dragonflies, swallows and a hawk are added once the meadow to circle is known: see below.)
// By default the camera slowly circles one meadow lobe, so the changes are
// watched in one place. ?tour=stream flies down the stream instead.
const TOUR = params.get('tour') === 'stream' ? 'stream' : 'orbit';
const FLY_HEIGHT = num('height', TOUR === 'orbit' ? meta.orbit.height : 7), FLY_SPEED = num('speed', 7);
const orbit = (() => {
  const [x, z] = params.has('orbit') ? params.get('orbit').split(',').map(Number) : [meta.orbit.x + coreOrigin.x, meta.orbit.z + coreOrigin.y];
  const o = { x, z, r: num('radius', meta.orbit.radius), period: num('period', 170), start: meta.orbit.start, y: groundAt(x, z), ring: [] };
  // How high the camera flies on each part of the circle. It has to clear the
  // ground and the crowns of the tallest trees that ever stand near the path
  // (at any stage, so the path never changes): a tree close under the camera
  // fills the frame and rushes through it. The profile is widened and smoothed
  // so the camera rises and sinks gently.
  const M = 96, CLEAR = num('clear', 18), WIDE = 8, last = meta.stages.keys[meta.stages.keys.length - 1];
  const need = Array.from({ length: M }, (_, i) => {
    const px = x + o.r * Math.cos(i / M * 2 * Math.PI), pz = z + o.r * Math.sin(i / M * 2 * Math.PI);
    return Math.max(o.y + FLY_HEIGHT, groundAt(px, pz) + 0.75 * FLY_HEIGHT, trees ? trees.heightToClear(px, pz, CLEAR, last) : -Infinity);
  });
  const around = (list, half, fn) => list.map((_, i) => fn(Array.from({ length: 2 * half + 1 }, (_, k) => list[(i + k - half + M) % M])));
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  o.ring = around(around(around(need, WIDE, (v) => Math.max(...v)), WIDE / 2, mean), WIDE / 2, mean);
  return o;
})();
// The landscape view: a second, much wider and higher circle that takes in
// every meadow of the 1 m window, on the same bearing as the first. `wide`
// (0..1) is how far the camera has flown out from one to the other.
const land = (() => {
  const L = meta.landscape ?? { x: N / 2, z: N / 2, radius: 700, height: 500, period: 300 };
  const x = L.x + coreOrigin.x, z = L.z + coreOrigin.y, y = groundAt(x, z);
  let top = y + L.height;
  for (let i = 0; i < 96; i++) top = Math.max(top, groundAt(x + L.radius * Math.cos(i / 96 * 2 * Math.PI), z + L.radius * Math.sin(i / 96 * 2 * Math.PI)) + 150);
  return { x, z, y, r: L.radius, top, period: L.period };
})();
const wildlife = params.get('wildlife') === '0' ? null
  : createWildlife({ core, shared, scene, floatLinear, meadow: { x: orbit.x, y: orbit.y, z: orbit.z } });
const smooth01 = (v) => v * v * (3 - 2 * v);
// The viewpoints (keys 1 to 6). Each gives the camera's position and what it
// looks at; `u` is how far round its circle the camera is, for those that circle.
function meadowPose(u, position, aim) {
  const a = orbit.start + u * 2 * Math.PI;
  const f = ((a / (2 * Math.PI)) % 1 + 1) % 1 * orbit.ring.length, j = Math.floor(f) % orbit.ring.length;
  const y = orbit.ring[j] + (orbit.ring[(j + 1) % orbit.ring.length] - orbit.ring[j]) * (f - Math.floor(f));
  position.set(orbit.x + orbit.r * Math.cos(a), y, orbit.z + orbit.r * Math.sin(a));
  aim.set(orbit.x, orbit.y + 1.5, orbit.z);
}
function valleyPose(u, position, aim) {
  const a = orbit.start + u * 2 * Math.PI;
  position.set(land.x + land.r * Math.cos(a), land.top, land.z + land.r * Math.sin(a));
  aim.set(land.x, land.y, land.z);
}
// Standing on the ground at a fixed spot, looking one way with a slow glance from side to side.
const EYE = 1.7;
function standing(spot, eye = EYE, lookHeight = 1.0) {
  const x = spot.x + coreOrigin.x, z = spot.z + coreOrigin.y, lx = spot.lookX + coreOrigin.x, lz = spot.lookZ + coreOrigin.y;
  let y = null;
  return (u, position, aim, dt = 0) => {
    // The ground can drop away under this spot (the channel cutting down); the eye follows it down, not at once.
    const target = groundAt(x, z) + eye;
    y = y === null || dt === 0 ? target : y + (target - y) * (1 - Math.exp(-dt * 2.5));
    position.set(x, y, z);
    const glance = 0.16 * Math.sin(shared.uTime.value * 0.11), c = Math.cos(glance), s = Math.sin(glance);
    aim.set(x + (lx - x) * c - (lz - z) * s, groundAt(lx, lz) + lookHeight, z + (lx - x) * s + (lz - z) * c);
  };
}
// A fixed, map-like view of the meadow from the south, north at the top. Not
// straight down: the trees are upright pictures and vanish seen from overhead.
function planPose(u, position, aim) {
  const v = meta.views.plan;
  position.set(v.x + coreOrigin.x, orbit.y + v.height, v.z + coreOrigin.y + v.height * 0.55);
  aim.set(v.x + coreOrigin.x, orbit.y, v.z + coreOrigin.y - 8);
}
const VIEWS = [
  { key: 'meadow', name: 'Circling the meadow', air: true, period: orbit.period, pose: meadowPose },
  { key: 'landscape', name: 'The whole valley', air: true, period: land.period, pose: valleyPose },
  { key: 'canopy', name: 'Under the old trees', pose: standing(meta.views.canopy, EYE, 3.0) },
  { key: 'rim', name: 'At the meadow\u2019s edge', pose: standing(meta.views.rim, 2.3, 0.0) },
  { key: 'channel', name: 'In the channel', pose: standing(meta.views.channel, 1.45, 0.6) },
  { key: 'plan', name: 'Like a map', air: true, period: orbit.period, pose: planPose },
];
// Going from one viewpoint in the air to another, the camera flies; to or from
// the ground it cuts, with a fade, so it never passes through the trees.
const flight = { from: 0, to: 0, t: 1, fromPos: new THREE.Vector3(), fromAim: new THREE.Vector3(), toPos: new THREE.Vector3(), toAim: new THREE.Vector3() };
function orbitPose(u, position, aim, dt) {
  VIEWS[flight.to].pose(u, flight.toPos, flight.toAim, dt);
  if (flight.t >= 1) { position.copy(flight.toPos); aim.copy(flight.toAim); return; }
  VIEWS[flight.from].pose(u, flight.fromPos, flight.fromAim, dt);
  const k = smooth01(flight.t);
  position.lerpVectors(flight.fromPos, flight.toPos, k);
  aim.lerpVectors(flight.fromAim, flight.toAim, k);
}
const pathXZ = meta.path.map(([x, z]) => [x + coreOrigin.x, z + coreOrigin.y]);
if (params.get('reverse') === '1') pathXZ.reverse();
const groundY = pathXZ.map(([x, z]) => rootedAt(x, z));
const curve = new THREE.CatmullRomCurve3(pathXZ.map(([x, z], i) => {
  let sum = 0, count = 0; // average the ground over ~100 m so the flight doesn't bob
  for (let k = Math.max(0, i - 4); k <= Math.min(pathXZ.length - 1, i + 4); k++) { sum += groundY[k]; count++; }
  return new THREE.Vector3(x, Math.max(sum / count + FLY_HEIGHT, groundY[i] + Math.min(3, FLY_HEIGHT)), z);
}));
const pathLength = curve.getLength();
// While the channel is still filled the ground under the path is higher; the flight rises with it.
const probe = new THREE.Vector3();
function fillLift(u) {
  let sum = 0;
  for (let k = -2; k <= 2; k++) {
    curve.getPointAt(Math.min(1, Math.max(0, u + k * 12 / pathLength)), probe);
    sum += groundAt(probe.x, probe.z) - rootedAt(probe.x, probe.z);
  }
  return sum / 5;
}
function streamPose(u, position, aim) {
  const lift = fillLift(u);
  curve.getPointAt(u, position);
  curve.getPointAt(Math.min(1, u + 70 / pathLength), aim);
  if (aim.distanceTo(position) < 1) { // at the very end, keep the last heading
    curve.getTangentAt(u, probe);
    aim.copy(position).addScaledVector(probe, 70);
  }
  position.y += lift;
  aim.y = Math.min(aim.y + lift, position.y) - 3;
}
const tourPose = TOUR === 'orbit' ? orbitPose : streamPose;

// ---- camera control -----------------------------------------------------------
const still = params.has('u'); // a fixed frame, for screenshots
const standAt = still && params.has('at') ? params.get('at').split(',').map(Number) : null;
const lookTo = standAt && params.has('look') ? params.get('look').split(',').map(Number) : null;
if (still) veil.style.transition = 'none';
// The timeline. Each stage has a name and a line of explanation (shown in the panel).
const STAGES = [
  ['Wet meadow', 'Water spreads across the valley floor through many small sandy channels. The water table is at the surface, under sedges and rushes, with willows along the channels and camas, shooting star and bistort in flower.'],
  ['One channel cuts down', 'A headcut works its way up the meadow and leaves a raw gully behind it. The gully takes all the flow, and the small channels above it go dry.'],
  ['The trench widens', 'Its banks fail and retreat. The meadow is now a terrace above the stream, drying from its edges inward. The old channels are left as dry sand.'],
  ['Conifers move in', 'Pine seedlings follow the drying front in from the forest edge. Corn lily, lupine and yarrow hold the ground that is still moist, and a new floodplain greens inside the trench.'],
  ['Thickets', 'Young pines close ranks on the dried ground, with mule\u2019s ears in the last openings. Meadow plants hang on near the stream.'],
  ['Closed stand', 'The thicket shades out its own understory and thins itself: standing dead poles, downed wood, bare litter.'],
  ['Mature forest', 'A closed canopy over a floor of needle litter and bracken fern where the meadow was. Wet meadow survives only on the new floodplain inside the trench.'],
];
const LAST = STAGES.length - 1;
const state = {
  mode: 'tour',                 // 'tour' follows the path, 'walk' is first person
  u: num('u', 0),
  yaw: 0, pitch: 0,             // walk: absolute heading and pitch
  look: new THREE.Vector3(),
  roads: num('roads', 0),       // 1 shows today's roads (H); the story is told without them
  heal: 1 - num('roads', 0),
  stage: Math.min(LAST, Math.max(0, num('stage', 0))),
  stageTarget: Math.min(LAST, Math.max(0, num('stage', 0))),
  playing: false,
  view: Math.max(0, VIEWS.findIndex((v) => v.key === params.get('view'))),   // which viewpoint (keys 1 to 6)
  ease: 1,                      // walking speed factor: 1 in the open, less among young trees
};
function applyTimeline() {
  shared.uStage.value = state.stage;
  shared.uHeal.value = state.heal * state.heal * (3 - 2 * state.heal);
}
applyTimeline();
const lookOffset = { yaw: num('yaw', 0) * Math.PI / 180, pitch: num('pitch', 0) * Math.PI / 180, held: false };

// ?walk=x,z[,heading] starts on foot at that point (metres from the window's centre, degrees clockwise from north).
if (params.has('walk') && !still) {
  const [x, z, heading = 0] = params.get('walk').split(',').map(Number);
  camera.position.set(x, groundAt(x, z) + 1.7, z);
  state.yaw = -heading * Math.PI / 180;
  state.mode = 'walk';
}

function setHud() {
  const common = '<b>Space</b> to play · <b>F</b> for the next stage · <b>H</b> to show today\'s roads · <b>I</b> for render info';
  hud.innerHTML = state.mode === 'tour'
    ? `<b>1</b>-<b>6</b> for viewpoints · <b>Drag</b> to look around · <b>Enter</b> to step in and walk · ${common} · <b>G</b> for the field guide · <b>M</b> to mute`
    : `<b>W A S D</b> to walk · <b>Shift</b> to run · ${common} · <b>G</b> for the field guide · <b>Esc</b> or <b>1</b>-<b>6</b> to return to a viewpoint`;
}
setHud();

// ---- timeline panel --------------------------------------------------------------
const panel = {
  title: document.getElementById('stage-title'), text: document.getElementById('stage-text'),
  track: document.getElementById('track'), knob: document.getElementById('knob'), done: document.getElementById('done'),
  stops: document.getElementById('stops'), play: document.getElementById('play'), shown: -1,
};
STAGES.forEach(([name], i) => {
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.textContent = name;
  stop.style.left = `${i / LAST * 100}%`;
  stop.addEventListener('click', () => { state.stageTarget = i; state.playing = false; });
  panel.stops.appendChild(stop);
});
function drawPanel() {
  const pct = `${state.stage / LAST * 100}%`;
  panel.knob.style.left = pct;
  panel.done.style.width = pct;
  panel.track.setAttribute('aria-valuenow', state.stage.toFixed(2));
  const nearest = Math.round(state.stage);
  if (nearest !== panel.shown) {
    panel.shown = nearest;
    panel.title.textContent = `${nearest + 1}. ${STAGES[nearest][0]}`;
    panel.text.textContent = STAGES[nearest][1];
    [...panel.stops.children].forEach((b, i) => b.classList.toggle('on', i === nearest));
  }
  panel.play.textContent = state.playing ? 'Pause' : 'Play';
}
function scrub(e) {
  const r = panel.track.getBoundingClientRect();
  state.stage = state.stageTarget = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * LAST;
  state.playing = false;
}
panel.track.addEventListener('pointerdown', (e) => { panel.track.setPointerCapture(e.pointerId); scrub(e); });
panel.track.addEventListener('pointermove', (e) => { if (panel.track.hasPointerCapture(e.pointerId)) scrub(e); });
// The viewpoints: a row of buttons, and keys 1 to 6.
const viewButtons = document.getElementById('views');
flight.from = flight.to = state.view;
function setView(i) {
  if (TOUR !== 'orbit' || !VIEWS[i]) return;
  leaveWalk();
  if (i !== flight.to) {
    const fly = VIEWS[i].air && VIEWS[flight.to].air && flight.t >= 1;
    flight.from = flight.to; flight.to = i; flight.t = fly ? 0 : 1;
    if (!fly) { state.look.set(0, 0, 0); lookOffset.yaw = lookOffset.pitch = 0; fadeIn(); }
  }
  state.view = i;
  [...viewButtons.children].forEach((b, k) => b.classList.toggle('on', k === i));
}
VIEWS.forEach((v, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = `<b>${i + 1}</b> ${v.name}`;
  b.classList.toggle('on', i === state.view);
  b.addEventListener('click', () => setView(i));
  viewButtons.appendChild(b);
});
if (TOUR !== 'orbit') viewButtons.hidden = true;
function togglePlay() {
  state.playing = !state.playing;
  if (state.playing && state.stage > LAST - 0.01) state.stage = state.stageTarget = 0; // from the top
}
panel.play.addEventListener('click', togglePlay);

let dragging = false;
canvas.addEventListener('pointerdown', (e) => {
  dragging = lookOffset.held = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => { dragging = lookOffset.held = false; });
canvas.addEventListener('pointercancel', () => { dragging = lookOffset.held = false; });
canvas.addEventListener('pointermove', (e) => {
  if (state.mode === 'walk' && (dragging || document.pointerLockElement === canvas)) { // dragging works if the mouse could not be captured
    state.yaw -= e.movementX * 0.0022;
    state.pitch = Math.min(1.4, Math.max(-1.4, state.pitch - e.movementY * 0.0022));
  } else if (dragging) {
    lookOffset.yaw -= e.movementX * 0.004;
    lookOffset.pitch = Math.min(1.0, Math.max(-1.0, lookOffset.pitch - e.movementY * 0.004));
  }
});

// Cut to the haze colour, then fade the picture back in. Hides camera jumps.
function fadeIn() {
  post.cut();
  veil.style.transition = 'none';
  veil.style.opacity = 1;
  void veil.offsetWidth;
  veil.style.transition = '';
  veil.style.opacity = 0;
}
function leaveWalk() {
  if (state.mode !== 'walk') return;
  state.mode = 'tour';
  lookOffset.yaw = lookOffset.pitch = 0;
  state.look.set(0, 0, 0);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  fadeIn();
  setHud();
}
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyH') state.roads = state.roads > 0.5 ? 0 : 1;
  if (e.code === 'KeyL') setView(state.view === 1 ? 0 : 1);
  if (e.code === 'KeyF' || (e.code === 'ArrowRight' && state.mode === 'tour')) { state.stageTarget = (Math.round(state.stageTarget) + (e.shiftKey ? LAST : 1)) % (LAST + 1); state.playing = false; }
  if (e.code === 'ArrowLeft' && state.mode === 'tour') { state.stageTarget = Math.max(0, Math.round(state.stageTarget) - 1); state.playing = false; }
  if (/^Digit[1-6]$/.test(e.code)) setView(Number(e.code.slice(5)) - 1);
  if (e.code === 'Space') { togglePlay(); e.preventDefault(); }
  if (e.code === 'Escape') leaveWalk();
  if (e.code === 'Enter' && state.mode === 'tour') {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    state.yaw = Math.atan2(-dir.x, -dir.z);
    state.pitch = Math.asin(dir.y);
    state.mode = 'walk';
    canvas.requestPointerLock?.();
    setHud();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) leaveWalk();
});

// Keep the walker inside the data, with a margin so the edge stays hazy.
const bounds = { x0: farOrigin.x + 60, x1: farOrigin.x + FW * FC - 60, z0: farOrigin.y + 60, z1: farOrigin.y + FH * FC - 60 };
const tmp = new THREE.Vector3(), ahead = new THREE.Vector3();

function updateTour(dt) {
  flight.t = Math.min(1, flight.t + dt / 6); // six seconds from one viewpoint in the air to another
  const k = smooth01(flight.t), period = (VIEWS[flight.from].period ?? orbit.period) * (1 - k) + (VIEWS[flight.to].period ?? orbit.period) * k;
  if (!still) state.u += dt / (TOUR === 'orbit' ? period : pathLength / FLY_SPEED);
  if (TOUR === 'stream' && state.u >= 1) { // loop back to the start
    state.u = 0;
    state.look.set(0, 0, 0);
    fadeIn();
  }
  if (TOUR === 'stream') state.u = Math.min(1, Math.max(0, state.u));
  tourPose(state.u, camera.position, ahead, dt);
  // How far the camera is above the meadow says how map-like the picture should be (see uWide in shaders.js).
  shared.uWide.value = smooth01(Math.min(1, Math.max(0, (camera.position.y - orbit.y - 150) / 350)));
  if (standAt) { // a still from a chosen spot (?at=x,z in metres from the window's centre), looking where the tour would
    camera.position.set(standAt[0], groundAt(standAt[0], standAt[1]) + FLY_HEIGHT, standAt[1]);
    if (lookTo) ahead.set(lookTo[0], groundAt(lookTo[0], lookTo[1]) + 0.4, lookTo[1]); // ?look=x,z aims at a point on the ground
    else if (TOUR === 'stream') { curve.getTangentAt(state.u, tmp); ahead.copy(camera.position).addScaledVector(tmp, 70); }
  }
  // Ease the aim point so bends in the path turn the camera gently.
  if (state.look.lengthSq() === 0 || still || TOUR === 'orbit') state.look.copy(ahead);
  else state.look.lerp(ahead, 1 - Math.exp(-dt * 1.2));
  camera.lookAt(state.look);
  if (!lookOffset.held && !still) { // drift back to the tour's own direction
    const k = Math.exp(-dt * 0.6);
    lookOffset.yaw *= k;
    lookOffset.pitch *= k;
  }
  camera.rotateOnWorldAxis(THREE.Object3D.DEFAULT_UP, lookOffset.yaw);
  camera.rotateX(lookOffset.pitch);
}

function updateWalk(dt) {
  shared.uWide.value = 0;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  // Pushing through young trees is slow going.
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 14 : 3.2) * state.ease * dt / Math.max(1, Math.hypot(f, s));
  const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
  const p = camera.position;
  p.x = Math.min(bounds.x1, Math.max(bounds.x0, p.x + (-sin * f + cos * s) * speed));
  p.z = Math.min(bounds.z1, Math.max(bounds.z0, p.z + (-cos * f - sin * s) * speed));
  if (trees) {
    const crowd = trees.walk(p);
    state.ease += (Math.max(0.15, 1 / (1 + 2.6 * crowd)) - state.ease) * (1 - Math.exp(-dt * 4));
  }
  const target = groundAt(p.x, p.z) + EYE;
  p.y += (target - p.y) * (1 - Math.exp(-dt * 10)); // settle onto the ground, smooth over bumps
  camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
}

// ---- resolution -----------------------------------------------------------------
// `scale` is how many pixels are rendered across one CSS pixel, and it follows
// what the GPU can do. A weak GPU gets a softer image rather than a slow one,
// and if that is not enough, fewer plants and no full-mesh trees. A strong one
// renders more pixels than the screen has and averages them down, which is
// what steadies fine foliage as the camera moves.
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const SCALE_MIN = 0.62;
const scaleMax = () => Math.min(num('maxscale', Math.min(2 * dpr, 2.5)), Math.sqrt(9e6 / (window.innerWidth * window.innerHeight)));
let scale = num('scale', Math.min(1, dpr)), detail = 1, detailShown = 1;
const adaptive = !params.has('scale') && !still;
// What the scene settled on last time on this GPU is where it starts this time.
const QUALITY_KEY = 'meadow.quality';
function rememberQuality() {
  try { localStorage.setItem(QUALITY_KEY, JSON.stringify({ gpu: gpuName, scale: +scale.toFixed(3), detail: +detail.toFixed(3), w: window.innerWidth, h: window.innerHeight })); } catch {}
}
function recallQuality() {
  if (!adaptive) return;
  try {
    const q = JSON.parse(localStorage.getItem(QUALITY_KEY) || 'null');
    if (!q || q.gpu !== gpuName) return;
    // A larger window than last time gets fewer pixels per pixel, to start at about the same cost.
    const area = (q.w * q.h) / (window.innerWidth * window.innerHeight);
    scale = Math.min(scaleMax(), Math.max(SCALE_MIN, q.scale * Math.sqrt(Math.min(1, area))));
    detail = detailShown = Math.min(1, Math.max(0.25, q.detail));
    grass?.setDetail(detail); trees?.setDetail(detail);
  } catch {}
}
function resize() {
  const size = (k) => [Math.max(2, Math.round(window.innerWidth * k)), Math.max(2, Math.round(window.innerHeight * k))];
  const [w, h] = size(Math.min(scale, dpr)); // the canvas never has more pixels than the screen
  renderer.setSize(w, h, false);
  post.setSize(...size(scale), w, h);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// How long the GPU spends on a frame, where the browser will say. (The time
// between frames only says whether the screen's refresh rate was met.)
const gl = renderer.getContext();
const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const gpu = { ms: 0, known: false, fresh: true, query: null, waiting: null };
function gpuBegin() {
  if (!timer || gpu.waiting) return;
  gpu.query = gl.createQuery();
  gl.beginQuery(timer.TIME_ELAPSED_EXT, gpu.query);
}
function gpuEnd() {
  if (gpu.query) {
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    gpu.waiting = gpu.query;
    gpu.query = null;
  } else if (gpu.waiting && gl.getQueryParameter(gpu.waiting, gl.QUERY_RESULT_AVAILABLE)) {
    if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
      const ms = gl.getQueryParameter(gpu.waiting, gl.QUERY_RESULT) / 1e6;
      gpu.ms = gpu.fresh ? ms : gpu.ms + (ms - gpu.ms) * 0.2;
      gpu.known = true;
      gpu.fresh = false;
    }
    gl.deleteQuery(gpu.waiting);
    gpu.waiting = null;
  }
}
const gpuName = (() => {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const full = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown GPU';
  const inner = /^ANGLE \((.*)\)$/.exec(full);
  return (inner ? inner[1].split(',')[1] ?? inner[1] : full).replace(/\(0x[0-9a-f]+\)/i, '').replace(/Direct3D.*$/, '').replace(/\s+/g, ' ').trim();
})();
// I shows what the scene is running on and at what quality.
recallQuality();
resize();
const statsEl = document.getElementById('stats');
let statsShown = num('info', 0) > 0, statsAt = 0;
window.addEventListener('keydown', (e) => { if (e.code === 'KeyI') { statsShown = !statsShown; statsAt = 0; statsEl.hidden = !statsShown; } });
statsEl.hidden = !statsShown;

// ---- sound -----------------------------------------------------------------------
// The sound follows the place and the stage (sound.js). Browsers let it start
// only on a click or a key, so it starts with the visitor's first one.
const sound = params.get('sound') === '0' ? null : createSound();
const muteButton = document.getElementById('mute');
function showMute() { muteButton.textContent = sound && !sound.muted ? 'Sound on' : 'Sound off'; muteButton.classList.toggle('off', !sound || sound.muted); }
if (sound) {
  muteButton.addEventListener('click', () => { sound.start(); sound.toggleMute(); showMute(); });
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyM') { sound.toggleMute(); showMute(); } });
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sound.start(), { once: true });
} else muteButton.hidden = true;
showMute();
let soundAt = 0;
function updateSound(now) {
  if (!sound || now < soundAt) return;
  soundAt = now + 150;
  const p = camera.position, stage = state.stage;
  const inCore = p.x > coreOrigin.x + 1 && p.z > coreOrigin.y + 1 && p.x < coreOrigin.x + N - 1 && p.z < coreOrigin.y + N - 1;
  let canopy = 0, water = 0, cut = 0;
  if (inCore) {
    const i = Math.floor(p.z - coreOrigin.y) * N + Math.floor(p.x - coreOrigin.x);
    // Canopy over the camera, from the same baked layers the shaders blend (one per key stage).
    const layers = meta.stages.keys.length, k = Math.min(layers - 1, Math.max(0, stage - meta.stages.keys[0])), k0 = Math.floor(k), k1 = Math.min(layers - 1, k0 + 1);
    canopy = (core.cover[(k0 * N * N + i) * 2 + 1] * (1 - (k - k0)) + core.cover[(k1 * N * N + i) * 2 + 1] * (k - k0)) / 255;
    // Running water: one of the meadow's small channels until the headcut has passed, or the stream itself.
    const since = stage - (CUT[0] + CUT[1] * core.arrive[i]);
    cut = smoothstep(0, CUT[2], since);
    const thread = Math.min(1, Math.max(0, 1 + core.threads[i] / 5)) * (1 - smoothstep(0, 0.3, since));
    water = Math.max(thread, Math.min(1, Math.max(0, 1 - core.dist[i] / 16)));
  }
  sound.update({ stage, height: Math.max(0, p.y - groundAt(p.x, p.z)), canopy, water, cut });
}

// ---- the field guide ---------------------------------------------------------------
const guide = createGuide({ plants: plantIndex, cards: cardIndex });
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyG' && !document.body.classList.contains('waiting')) guide.toggle();
  if (e.code === 'Escape' && guide.open) guide.toggle(false);
});

// ---- the start screen ------------------------------------------------------------
// The scene is already running behind it, blurred, so its quality has settled
// by the time the visitor begins; and the click that begins is what lets the
// sound start. Fixed frames (?u=) and ?start=0 go straight in.
const startScreen = document.getElementById('start');
function begin() {
  if (!document.body.classList.contains('waiting')) return;
  document.body.classList.remove('waiting');
  startScreen.setAttribute('aria-hidden', 'true');
  sound?.start();
  canvas.focus?.();
}
if (still || params.get('start') === '0') { document.body.classList.add('instant'); document.body.classList.remove('waiting'); startScreen.hidden = true; }
else {
  document.getElementById('begin').addEventListener('click', begin);
  window.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') { if (document.body.classList.contains('waiting')) { begin(); e.stopImmediatePropagation(); e.preventDefault(); } } }, true);
}
{ // Where the support link goes is set in index.html (data-support on <body>); with none, there is no button.
  const support = document.getElementById('support'), url = document.body.dataset.support;
  if (url) support.href = url; else support.hidden = true;
}

// ---- frame loop --------------------------------------------------------------
let last = performance.now(), frames = 0, frameMs = 16, sinceResize = 0, renderMs = 0;
let stillTime = num('time', 0); // the clock of a fixed frame (?u=)
let slowRun = 0;                // slow readings in a row (see the quality control in draw)
let manual = false;
const bench = params.has('bench'), benchPixel = new Uint8Array(4);
window.__meadow = {
  frames: 0,
  // For tools/flicker.mjs: move a fixed frame along the tour and set its clock,
  // or stop the clock altogether and draw exactly one frame per call.
  pose(u, time) { state.u = u; stillTime = time; },
  step(u, time, stage) {
    manual = true; state.u = u; stillTime = time;
    if (stage !== undefined) state.stage = state.stageTarget = stage;
    draw(performance.now());
  },
  stats() {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { ms: bench ? renderMs : frameMs, gpuMs: gpu.known ? gpu.ms : null, scale, detail: detailShown, stage: state.stage, view: VIEWS[state.view].key,
      sound: sound ? { running: sound.running, muted: sound.muted } : null, nearTrees: trees?.nearCount ?? 0, ease: state.ease, mode: state.mode, position: camera.position.toArray(), ground: groundAt(camera.position.x, camera.position.z), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown' };
  },
};
renderer.info.autoReset = false; // count the scene and the post passes together

function approach(value, target, step) {
  return value + Math.sign(target - value) * Math.min(Math.abs(target - value), step);
}
function frame(now) {
  if (!manual) draw(now);
  requestAnimationFrame(frame);
}
function draw(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); // the first timestamp can precede `last`
  frameMs += (now - last - frameMs) * 0.05;
  last = now;
  shared.uTime.value = still ? stillTime : now / 1000;
  state.heal = approach(state.heal, 1 - state.roads, dt / 2.5);
  if (state.playing) { // about ten seconds a stage
    state.stage = state.stageTarget = Math.min(LAST, state.stage + dt / 10);
    if (state.stage >= LAST) state.playing = false;
  } else {
    state.stage = approach(state.stage, state.stageTarget, dt * Math.max(0.3, Math.abs(state.stageTarget - state.stage) * 0.9));
  }
  applyTimeline();
  drawPanel();
  if (state.mode === 'tour') updateTour(dt);
  else updateWalk(dt);
  camera.updateMatrixWorld();
  updateTiles();
  trees?.update(camera, frustum);
  grass?.update(camera.position.y - groundAt(camera.position.x, camera.position.z));
  logs?.update(camera);
  renderer.info.reset();
  gpuBegin();
  post.render(scene, camera);
  gpuEnd();
  updateSound(now);
  if (bench) { // wait for the GPU so the frame time is the true cost
    const gl = renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, benchPixel);
    renderMs += (performance.now() - now - renderMs) * 0.1;
  }

  if (adaptive && ++sinceResize > 40) {
    sinceResize = 0;
    let next = scale;
    if (gpu.known) {
      // The GPU's time goes roughly with the number of pixels. Above the
      // screen's own resolution, aim for about 9 ms so there is always room
      // inside a 60 Hz frame; at or below it, only give ground when 30 frames
      // a second cannot be held.
      const cost = gpu.ms, top = scaleMax(), toward = (ms) => scale * Math.min(1.35, Math.max(0.75, Math.sqrt(ms / cost)));
      if (scale > 1 && cost > 11.5) next = Math.max(1, toward(9));
      else if (cost > 30) {
        // (Thinning the plants takes two slow readings in a row: one may be the machine doing something else.)
        if (scale > SCALE_MIN) next = Math.max(SCALE_MIN, toward(24)); else if (++slowRun >= 2) detail = Math.max(0.25, detail * 0.85);
      }
      else if (detail < 1) { if (cost < 20) detail = Math.min(1, detail * 1.12); }
      else if (scale < 1) { if (cost < 14) next = Math.min(1, toward(20)); }
      else if (cost < 7 && scale < top) next = Math.min(top, toward(9));
    } else { // no GPU timing: go by the time between frames, and never beyond the screen's resolution
      const slow = frameMs > 30, fast = frameMs < 15;
      if (slow) { if (scale > SCALE_MIN) next = Math.max(SCALE_MIN, scale * 0.87); else detail = Math.max(0.25, detail * 0.85); }
      if (fast) { if (detail < 1) detail = Math.min(1, detail * 1.12); else next = Math.min(1, dpr, scale * 1.07); }
    }
    if (!(gpu.known && gpu.ms > 30)) slowRun = 0;
    if (Math.abs(next - scale) > 0.04 * scale) { scale = next; resize(); gpu.fresh = true; sinceResize = -20; }
    if (frames % 240 < 41) rememberQuality();
  }
  // Plants are thinned and restored gradually, each one shrinking or growing, not all at once.
  if (detailShown !== detail) {
    detailShown = approach(detailShown, detail, dt * 0.1);
    grass?.setDetail(detailShown);
    trees?.setDetail(detailShown);
  }
  if (statsShown && now > statsAt) {
    statsAt = now + 500;
    statsEl.textContent = `${gpuName} · ${Math.round(1000 / frameMs)} fps` + (gpu.known ? ` · ${gpu.ms.toFixed(1)} ms on the GPU` : '')
      + ` · ${scale.toFixed(2)}x resolution (${renderer.domElement.width} x ${renderer.domElement.height} shown)` + ` · plants ${Math.round(detailShown * 100)}%`;
  }
  window.__meadow.frames = ++frames;
  if (frames === 2) { loading.shown = true; veil.textContent = ''; veil.style.opacity = 0; document.body.dataset.ready = '1'; document.getElementById('begin').disabled = false; }
}
requestAnimationFrame(frame);
