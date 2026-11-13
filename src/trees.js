// Conifers. Beyond a few tens of metres every tree is one camera-facing card
// showing a scanned tree (Poly Haven, CC0) rendered offline from eight sides,
// with its own shading from this scene's sun and sky baked in
// (tools/bake_cards.html). The card shows whichever side faces the camera.
// Closer trees are real geometry (neartrees.js).
//
// Every tree has a life on the scene's timeline: when it germinates, how tall
// it can grow, when (if ever) it dies. Its height, and whether it is drawn as a
// sapling, a grown tree or a snag, follow from the stage (treeNow, here and in
// shaders.js).
import * as THREE from 'three';
import { COMMON_GLSL } from './shaders.js';
import { createNearTrees } from './neartrees.js';

const TILE = 128; // metres; trees are grouped and culled per tile

const CARD_VS = (types, views) => /* glsl */ `
${COMMON_GLSL}
#define TYPES ${types}
#define VIEWS ${views}.0
uniform sampler2D uBake;
uniform sampler2D uChan;      // alpha: 0 at the edge of the data, 1 well inside
uniform sampler2DArray uStages;
uniform vec2 uOrigin;
uniform vec2 uExtent;
uniform vec4 uFrame[TYPES];   // per tree type, in tree heights: card width, card height, card bottom; and foliage density
uniform vec4 uBounds[TYPES];  // the part of the card the tree occupies: left, right, bottom, top
uniform vec2 uLod;            // distance over which near trees hand over to cards
uniform float uHasNear[TYPES]; // 1 for a tree that has a full mesh for close range (neartrees.js); the rest stay cards
attribute vec4 aTree;         // world x, y, z of the base and full height
attribute vec4 aLife;         // stage it germinates, stage it dies, seed, its three pictures (sapling + 32 x grown + 1024 x snag)
varying vec3 vWorld;
varying vec4 vLight;          // neighbours' shadow at the base, terrain shadow, sky visibility, height fraction
varying vec3 vTint;
varying vec2 vUv;
varying vec4 vView;           // the two nearest baked views, blend between them, tree type
varying float vDensity;
varying float vFade;
varying float vEdge;

void main() {
  float what;
  float h = treeNow(aTree.w, aLife.x, aLife.y, aLife.z, what);
  float packed = aLife.w + 0.5;
  // A tree on a road's line is only there while the roads are hidden (32768 marks it).
  float onRoad = step(32768.0, packed);
  packed -= onRoad * 32768.0;
  float standing = mix(1.0, smoothstep(0.35, 0.9, uHeal), onRoad);
  // Toward the edge of the data the forest thins and dissolves into the sky with the ground.
  vEdge = smoothstep(0.0, 1.0, texture2D(uChan, (aTree.xz - uOrigin) / uExtent).a);
  h *= standing * smoothstep(0.0, 0.35, vEdge);
  if (what < 0.5 || standing <= 0.0 || vEdge < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  int type = int(what > 2.5 ? floor(packed / 1024.0) : what > 1.5 ? mod(floor(packed / 32.0), 32.0) : mod(packed, 32.0));
  vec4 frame = uFrame[type];
  vec3 base = aTree.xyz;

  // Shadow from the terrain and from neighbouring trees, sampled a step toward
  // the sun so the tree's own trunk doesn't count: its own shading is already
  // in the card.
  vec2 sunward = normalize(uSunDir.xz) * 1.6;
  vec3 bake = texture2D(uBake, (base.xz - uOrigin) / uExtent).rgb;
  float past = treeShade(uStages, (base.xz + sunward - uOrigin) / uExtent).x;   // sunlight past the neighbours
  float terrain = sunShadow(bake.r);
  vec4 bounds = uBounds[type];
  vec2 cell = vec2(mix(bounds.x, bounds.y, position.x + 0.5), mix(bounds.z, bounds.w, position.y));
  float height = clamp(frame.z + cell.y * frame.y, 0.0, 1.0);
  vLight = vec4(terrain * past, terrain, 0.5 + 0.5 * bake.g, height);
  float s = aLife.z;
  vTint = vec3(0.9 + 0.25 * s, 0.92 + 0.16 * fract(s * 7.3), 0.85 + 0.3 * fract(s * 3.1)) * (0.85 + 0.3 * fract(s * 13.7));
  vDensity = frame.w;

  vec3 toCam = cameraPosition - (base + vec3(0.0, h * 0.5, 0.0));
  float reach = clamp(h / 16.0, 0.4, 1.0);           // small trees hand over to geometry closer in
  vFade = uHasNear[type] > 0.5 ? smoothstep(uLod.x * reach, uLod.y * reach, length(toCam)) : 1.0;
  if (vFade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 f = normalize(toCam.xz);
  float view = atan(f.x, f.y) / 6.2831853 * VIEWS;
  float k = floor(view);
  vView = vec4(mod(k + VIEWS, VIEWS), mod(k + 1.0 + VIEWS, VIEWS), smoothstep(0.4, 0.6, view - k), float(type));

  vec3 right = vec3(f.y, 0.0, -f.x);
  vec3 p = base + right * ((cell.x - 0.5) * frame.x * h) + vec3(0.0, (frame.z + cell.y * frame.y) * h, 0.0);
  vec2 wind = vec2(0.94, 0.34);
  p.xz += wind * (snoise(base.xz * 0.02 - wind * uTime * 0.25) - 0.4) * 0.006 * h * height * height;
  vWorld = p;
  vUv = cell;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const CARD_FS = (rows, columns, views) => /* glsl */ `
${COMMON_GLSL}
#define ROWS ${rows}.0
#define COLUMNS ${columns}.0
#define VIEWS ${views}.0
uniform sampler2D uCardA;     // colour, coverage
uniform sampler2D uCardB;     // normal x, y; sunlit fraction; sky visibility
uniform vec2 uAtlasSize;
varying vec3 vWorld;
varying vec4 vLight;
varying vec3 vTint;
varying vec2 vUv;
varying vec4 vView;
varying float vDensity;
varying float vFade;
varying float vEdge;

// One baked view of the tree: colour and coverage, its shading, and the normal in world space.
void bakedView(float k, vec2 inCell, vec2 dx, vec2 dy, out vec4 a, out vec4 b, out vec3 N) {
  float column = floor((vView.w + 0.5) / ROWS), row = vView.w - column * ROWS;
  vec2 uv = vec2((column * VIEWS + k + inCell.x) / (VIEWS * COLUMNS), (row + 1.0 - inCell.y) / ROWS);
  a = textureGrad(uCardA, uv, dx, dy);
  b = textureGrad(uCardB, uv, dx, dy);
  float th = k / VIEWS * 6.2831853;
  vec3 toward = vec3(sin(th), 0.0, cos(th)), right = vec3(cos(th), 0.0, -sin(th));
  vec2 n = b.xy * 2.0 - 1.0;
  N = right * n.x + vec3(0.0, n.y, 0.0) + toward * sqrt(max(0.0, 1.0 - dot(n, n)));
}

void main() {
  if (dither(gl_FragCoord.xy) <= 1.0 - vFade) discard; // handing over to the full tree (neartrees.js)
  vec2 inCell = clamp(vUv, vec2(0.003), vec2(0.997));
  // Derivatives of the coordinate within one view, so mipmaps are chosen the same for every view.
  vec2 smoothUv = vec2(vUv.x / (VIEWS * COLUMNS), -vUv.y / ROWS);
  vec2 dx = dFdx(smoothUv), dy = dFdy(smoothUv);
  vec4 a, b; vec3 N;
  bakedView(vView.x, inCell, dx, dy, a, b, N);
  // Between two baked views the pictures dissolve into each other. (Choosing
  // one per pixel instead sparkles as the tree moves across the screen.)
  if (vView.z > 0.0) {
    vec4 a2, b2; vec3 N2;
    bakedView(vView.y, inCell, dx, dy, a2, b2, N2);
    float w1 = a.a * (1.0 - vView.z), w2 = a2.a * vView.z, sum = max(w1 + w2, 1e-4);
    a = vec4((a.rgb * w1 + a2.rgb * w2) / sum, mix(a.a, a2.a, vView.z));
    b = (b * w1 + b2 * w2) / sum;
    N = N * w1 + N2 * w2;
  }
  N = normalize(N + vec3(0.0, 1e-4, 0.0));
  // Small mipmaps average foliage with the gaps around it; give coverage back.
  float lod = max(0.0, 0.5 * log2(max(dot(dx * uAtlasSize, dx * uAtlasSize), dot(dy * uAtlasSize, dy * uAtlasSize))));
  // Push coverage toward solid-or-empty: half-covered pixels across a whole
  // crown show the multisampling pattern as a screen-door.
  float alpha = smoothstep(0.22, 0.62, a.a * vDensity * (1.0 + 0.2 * lod));
  if (alpha < 0.06) discard;

  float neighbours = mix(vLight.x, vLight.y, smoothstep(0.05, 0.6, vLight.w)); // lower crowns sit in the forest's shade
  vec3 rd = normalize(vWorld - cameraPosition);
  float through = pow(max(dot(rd, uSunDir), 0.0), 4.0);                        // light through the needles
  float direct = b.z * (0.4 + 0.6 * abs(dot(N, uSunDir))) + 0.2 * through * b.a;
  vec3 light = uSunColor * direct * neighbours
             + mix(uGroundAmbient, uSkyAmbient, N.y * 0.5 + 0.5) * b.a * vLight.z;
  vec3 seen = applyFog(a.rgb * vTint * light, vWorld);
  if (vEdge < 0.995) seen = mix(skyColor(rd, 0.0), seen, vEdge);
  gl_FragColor = vec4(seen, alpha);
}
`;

export function createTrees({ buffer, life, cards, cardA, cardB, near, levels, farOrigin, shared, groundAt, scene, quality = 1 }) {
  const types = cards.trees, views = cards.views;
  // How much to thicken each tree's foliage; the sparser scans need more.
  const density = { fir: 1.5, pine: 1.9, sapling: 2.4, pinesapling: 2.0, snag: 2.8, willow: 1.5, deadwillow: 2.8 };
  const bare = types.map((t) => t.kind === 'snag' || t.kind === 'deadwillow'); // standing dead: no foliage
  if (types.length > 32) throw new Error(`cards.json has ${types.length} trees; a tree's pictures are packed 32 to a slot`);
  const frames = types.map((t) => new THREE.Vector4(
    t.frameWidth / t.height, t.frameHeight / t.height, t.frameBottom / t.height,
    density[t.kind] * (t.name.includes('fir_tree_01_c') ? 1.5 : 1)));

  // Trees nearer than lod.x are geometry, farther than lod.y cards, and a
  // per-pixel mix in between. With no near data everything is a card.
  const NEAR = near ? [23 * quality, 26.5 * quality] : [-2, -1];
  const lod = new THREE.Vector2(...NEAR);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const materials = levels.map((level) => new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uBake: { value: level.bake }, uChan: { value: level.chan }, uStages: { value: level.stages },
      uOrigin: { value: level.origin }, uExtent: { value: level.extent },
      uFrame: { value: frames }, uBounds: { value: types.map((t) => new THREE.Vector4(...t.bounds)) },
      uCardA: { value: cardA }, uCardB: { value: cardB },
      uAtlasSize: { value: new THREE.Vector2(cards.cell[0] * views * cards.columns, cards.cell[1] * cards.rows) },
      uLod: { value: lod }, uHasNear: { value: types.map((_, i) => (near?.index.trees[i] ? 1 : 0)) },
    },
    vertexShader: CARD_VS(types.length, views), fragmentShader: CARD_FS(cards.rows, cards.columns, views),
    side: THREE.DoubleSide, alphaToCoverage: true,
  }));

  // Group trees by tile. The file is sorted by when each tree germinates, so
  // each tile's list is too, and the trees alive so far are a prefix of it.
  const view = new DataView(buffer);
  const REC = life.bytes;
  const count = buffer.byteLength / REC;
  const stageOf = (byte, special, value) => (byte === special ? value : byte / 255 * 8 - 1);
  const groups = new Map();
  for (let i = 0; i < count; i++) {
    const x = view.getUint16(i * REC, true) / 10, z = view.getUint16(i * REC + 2, true) / 10;
    const key = Math.floor(x / TILE) + 4096 * Math.floor(z / TILE);
    let g = groups.get(key);
    if (!g) groups.set(key, g = []);
    g.push(i);
  }
  const core = levels[0];
  const tiles = [];
  for (const [key, list] of groups) {
    const n = list.length;
    const tree = new Float32Array(n * 4), lives = new Float32Array(n * 4);
    let lo = Infinity, hi = -Infinity;
    list.forEach((i, k) => {
      const o = i * REC;
      const x = view.getUint16(o, true) / 10 + farOrigin.x, z = view.getUint16(o + 2, true) / 10 + farOrigin.y;
      const hmax = view.getUint8(o + 4) * 0.2;
      const y = groundAt(x, z) - 0.1; // roots a little into the ground, so trunks on slopes don't float
      const pictures = (p) => Math.min(types.length - 1, view.getUint8(o + p));
      tree.set([x, y, z, hmax], k * 4);
      lives.set([stageOf(view.getUint8(o + 5), 0, -10), stageOf(view.getUint8(o + 6), 255, 99), view.getUint8(o + 7) / 255,
        pictures(8) + 32 * pictures(9) + 1024 * pictures(10) + 32768 * (view.getUint8(o + 11) ? 1 : 0)], k * 4);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y + hmax * 1.1);
    });
    const tx = key % 4096, tz = Math.floor(key / 4096);
    const x0 = farOrigin.x + tx * TILE, z0 = farOrigin.y + tz * TILE;
    const cx = x0 + TILE / 2, cz = z0 + TILE / 2;
    const inCore = cx > core.origin.x && cz > core.origin.y && cx < core.origin.x + core.extent.x && cz < core.origin.y + core.extent.y;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = geometry.index;
    geo.setAttribute('position', geometry.attributes.position);
    geo.setAttribute('aTree', new THREE.InstancedBufferAttribute(tree, 4));
    geo.setAttribute('aLife', new THREE.InstancedBufferAttribute(lives, 4));
    geo.instanceCount = 0; // set from the stage in update()
    const mesh = new THREE.Mesh(geo, materials[inCore ? 0 : 1]);
    mesh.position.set(cx, (lo + hi) / 2, cz); // only used to sort tiles front to back
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2; // after the nearest grass, before the ground
    scene.add(mesh);
    tiles.push({ tree, life: lives, mesh, count: 0,
      box: new THREE.Box3(new THREE.Vector3(x0 - 14, lo, z0 - 14), new THREE.Vector3(x0 + TILE + 14, hi, z0 + TILE + 14)) });
  }

  // The same rule as treeNow in shaders.js. Returns the height; sets now.what
  // (0 not there, 1 sapling, 2 grown, 3 standing dead) and now.type (its picture).
  const now = { what: 0, type: 0 };
  function treeNow(t, i, stage) {
    const hmax = t.tree[i * 4 + 3], birth = t.life[i * 4], death = t.life[i * 4 + 1];
    const h = hmax * Math.pow(Math.min(1, Math.max(0, (Math.min(stage, death) - birth) / life.growSpan)), life.growPow);
    now.what = 0;
    if (stage > birth && h >= 0.25) {
      now.what = stage < death ? (h < life.switchHeight ? 1 : 2) : (stage < death + 0.35 + 0.4 * t.life[i * 4 + 2] ? 3 : 0);
    }
    let p = t.life[i * 4 + 3];
    if (p >= 32768) { // on a road's line: not there when the roads are shown
      p -= 32768;
      if (shared.uHeal.value < 0.5) now.what = 0;
    }
    now.type = now.what === 3 ? Math.floor(p / 1024) : now.what === 2 ? Math.floor(p / 32) % 32 : p % 32;
    return h;
  }

  const nearTrees = near && createNearTrees({ ...near, heights: types.map((t) => t.height), levels, shared, scene, lod, treeNow, now });

  let lastStage = null;
  return {
    count,
    nearCount: 0,
    // Shrink the range of full-geometry trees on slow GPUs, smoothly down to cards only.
    setDetail(d) {
      const k = Math.min(1, Math.max(0, (d - 0.4) / 0.6));
      if (near) lod.set(...(k > 0 ? NEAR.map((v) => v * k) : [-2, -1]));
    },
    // How high a camera over this point has to be to keep `clear` metres above
    // the top of every tree within 25 m, at any stage up to `until`, and a
    // margin that shrinks with distance above those out to 85 m (a tall tree
    // 40 m off still fills the frame if the camera is level with its crown).
    heightToClear(x, z, clear, until) {
      const r = 85;
      let need = -Infinity;
      for (const t of tiles) {
        if (x < t.box.min.x - r || x > t.box.max.x + r || z < t.box.min.z - r || z > t.box.max.z + r) continue;
        for (let i = 0, n = t.tree.length / 4; i < n; i++) {
          const dx = t.tree[i * 4] - x, dz = t.tree[i * 4 + 2] - z, d2 = dx * dx + dz * dz;
          if (d2 > r * r) continue;
          const span = Math.min(until, t.life[i * 4 + 1]) - t.life[i * 4];
          const tallest = t.tree[i * 4 + 3] * Math.pow(Math.min(1, Math.max(0, span / life.growSpan)), life.growPow);
          need = Math.max(need, t.tree[i * 4 + 1] + tallest + clear * (1 - Math.max(0, Math.sqrt(d2) - 25) / 60));
        }
      }
      return need;
    },
    // For walking: moves the point out of any trunk it is inside, and returns
    // how much young foliage crowds it (0 in the open, 2 or more deep in a thicket).
    walk(point) {
      const stage = shared.uStage.value;
      let crowd = 0;
      for (const t of tiles) {
        if (t.count === 0 || point.x < t.box.min.x || point.x > t.box.max.x || point.z < t.box.min.z || point.z > t.box.max.z) continue;
        for (let i = 0; i < t.count; i++) {
          const dx = point.x - t.tree[i * 4], dz = point.z - t.tree[i * 4 + 2];
          if (dx > 3 || dx < -3 || dz > 3 || dz < -3) continue;
          const h = treeNow(t, i, stage);
          if (now.what === 0) continue;
          const d = Math.hypot(dx, dz), trunk = 0.3 + 0.012 * h;
          if (d < trunk) {
            const push = d > 1e-3 ? (trunk - d) / d : 0;
            point.x += d > 1e-3 ? dx * push : trunk;
            point.z += dz * push;
          }
          // Saplings carry branches to the ground; grown trees have clear trunks.
          const crown = 0.25 * h;
          if (now.what === 1 && d < crown && !bare[now.type]) crowd += 1 - d / crown;
        }
      }
      return crowd;
    },
    update(camera, frustum) {
      const stage = shared.uStage.value;
      for (const t of tiles) {
        if (stage !== lastStage) {
          let a = 0, b = t.tree.length / 4; // trees that have germinated
          while (a < b) { const m = (a + b) >> 1; if (t.life[m * 4] < stage) a = m + 1; else b = m; }
          t.count = t.mesh.geometry.instanceCount = a;
        }
        t.mesh.visible = t.count > 0 && frustum.intersectsBox(t.box);
      }
      lastStage = stage;
      if (nearTrees) this.nearCount = nearTrees.update(camera, tiles);
    },
  };
}
