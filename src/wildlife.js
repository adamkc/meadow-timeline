// Things that fly: butterflies over the flowers and dragonflies over the
// water (both in a ring that travels with the camera, like the plants),
// swallows hawking insects low over the open meadow, and a hawk circling high
// above it. All of it follows the timeline: the insects go as the meadow
// dries, the swallows as the trees close in. The hawk stays.
//
// Every animal is the same few triangles (a body and two wings) shaped,
// coloured and flown by the vertex shader from the clock alone, so there is
// nothing to update per frame.
import * as THREE from 'three';
import { COMMON_GLSL } from './shaders.js';

const VS = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D uHeights, uChan, uZone, uWater, uWaterHealed;
uniform sampler2DArray uStages;
uniform vec2 uOrigin, uExtent, uRes;
uniform float uPatch;      // size of the insects' ring, metres
uniform vec3 uMeadow;      // the circled meadow: centre x, ground height, centre z
attribute vec3 aPart;      // across the wings (-1 left tip .. 1 right tip), along the body (-0.5 tail .. 0.5 head), part (0 body, 1 wing)
attribute vec2 aOff;       // home within the ring
attribute vec4 aRnd;
attribute float aKind;     // 0 butterfly, 1 dragonfly, 2 swallow, 3 hawk
varying vec3 vWorld;
varying vec3 vColor;
varying float vAlpha;

float groundAtPoint(vec2 xz) {
  vec2 uv = (xz - uOrigin) / uExtent;
  return groundHeight(fetchGround(uHeights, uv, uRes), texture2D(uChan, uv));
}

void main() {
  int kind = int(aKind + 0.5);
  float t = uTime, seed = aRnd.w;
  vec2 cam = cameraPosition.xz;
  vec3 centre;             // where the animal is
  vec2 velocity;           // which way it is going, east and south
  float size = 1.0;        // 0 hides it
  float flap = 0.0, roll = 0.0;
  // half wing span, wing chord, body length, body half-width; how the wing narrows to its tip, and sweeps back
  vec4 shape; vec2 wing;
  vec3 colour, wingColour;
  float wingAlpha = 1.0;

  if (kind < 2) {
    // ---- insects: each keeps a home in the world (its offset wraps round the ring)
    vec2 home = aOff + uPatch * floor((cam - aOff) / uPatch + 0.5);
    float away = distance(home, cam);
    vec2 uv = (home - uOrigin) / uExtent;
    if (away > 0.5 * uPatch || any(lessThan(uv, vec2(0.002))) || any(greaterThan(uv, vec2(0.998)))) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 chan = texture2D(uChan, uv), zone = texture2D(uZone, uv);
    float arrive = chan.r;
    float wet = moisture(zone.r, zone.g, zone.b, arrive);
    float open = 1.0 - smoothstep(0.25, 0.6, treeShade(uStages, uv).y);
    vec2 flow;
    float suits;
    if (kind == 0) {
      // Butterflies: open ground with flowers on it, from wet meadow to the moist terrace.
      vec4 g = fetchGround(uHeights, uv, uRes);
      suits = smoothstep(0.25, 0.5, wet) * open * (1.0 - freshBank(g.a, g.b, arrive)); // not over the trench's raw floor: nothing flowers there yet
      float a = t * 0.33 + aRnd.x * 6.283;
      vec2 w = vec2(sin(a) + 0.5 * sin(2.3 * a + aRnd.y * 6.283), cos(0.8 * a + aRnd.z * 6.283) + 0.5 * sin(1.7 * a + seed * 6.283));
      velocity = vec2(cos(a) + 1.15 * cos(2.3 * a + aRnd.y * 6.283), -0.8 * sin(0.8 * a + aRnd.z * 6.283) + 0.85 * cos(1.7 * a + seed * 6.283));
      centre.xz = home + 2.3 * w;
      centre.y = 0.4 + 0.45 * (0.5 + 0.5 * sin(a * 1.9 + seed * 40.0)) + 0.06 * sin(t * 9.0 + seed * 60.0);
      flap = 0.35 + 1.1 * sin(t * (10.0 + 4.0 * aRnd.x) + seed * 90.0);
      shape = vec4(0.06, 0.074, 0.04, 0.006); wing = vec2(1.35, -0.15);
      float pick = fract(seed * 17.3);
      wingColour = pick < 0.4 ? vec3(0.8, 0.36, 0.05) : pick < 0.65 ? vec3(0.85, 0.72, 0.16) : pick < 0.85 ? vec3(0.82, 0.82, 0.76) : vec3(0.22, 0.34, 0.8);
      colour = vec3(0.05, 0.04, 0.03);
    } else {
      // Dragonflies: over water, hovering, then darting to another spot.
      float threads = threadWater((chan.g - 0.5) * 8.0 + 1.5, arrive);
      float stream = waterAt(uWater, uWaterHealed, uv, incised(arrive), flow) + 2.0;
      suits = max(smoothstep(-0.5, 0.5, threads) * (1.0 - removed(fetchGround(uHeights, uv, uRes).a, arrive)), smoothstep(0.0, 1.0, stream)) * open;
      float T = 1.3 + aRnd.x, phase = t / T + aRnd.y * 7.0, i = floor(phase), f = fract(phase);
      vec2 from = vec2(hash12(vec2(i, seed * 91.7)), hash12(vec2(i, seed * 37.1))) - 0.5;
      vec2 to = vec2(hash12(vec2(i + 1.0, seed * 91.7)), hash12(vec2(i + 1.0, seed * 37.1))) - 0.5;
      float go = smoothstep(0.55, 1.0, f);
      centre.xz = home + 5.0 * mix(from, to, go);
      velocity = to - from;
      centre.y = 0.35 + 0.7 * mix(hash12(vec2(i, seed * 13.3)), hash12(vec2(i + 1.0, seed * 13.3)), go) + 0.015 * sin(t * 21.0 + seed * 50.0);
      flap = 0.12 + 0.2 * sin(t * 47.0 + seed * 80.0);
      shape = vec4(0.058, 0.03, 0.078, 0.0035); wing = vec2(0.75, 0.0);
      float pick = fract(seed * 23.7);
      colour = pick < 0.45 ? vec3(0.1, 0.32, 0.75) : pick < 0.8 ? vec3(0.14, 0.5, 0.2) : vec3(0.7, 0.12, 0.07);
      wingColour = vec3(0.8, 0.85, 0.9); wingAlpha = 0.45;
    }
    size = step(fract(seed * 7.31), suits) * (1.0 - smoothstep(0.32, 0.5, away / uPatch));
    centre.y += groundAtPoint(centre.xz);
  } else if (kind == 2) {
    // ---- swallows: loops low over the open meadow, flapping and gliding by turns
    float th = t * (0.24 + 0.14 * aRnd.x) + seed * 6.283, k = 1.5 + floor(aRnd.y * 2.0) * 0.5;
    vec2 reach = vec2(46.0, 30.0) * (0.45 + 0.55 * aRnd.z);
    float turn = aRnd.x * 3.0, c = cos(turn), s = sin(turn);
    vec2 p = vec2(reach.x * sin(th), reach.y * sin(k * th + aRnd.y * 6.283));
    vec2 v = vec2(reach.x * cos(th), reach.y * k * cos(k * th + aRnd.y * 6.283));
    centre.xz = uMeadow.xz + vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    velocity = vec2(c * v.x - s * v.y, s * v.x + c * v.y);
    vec2 uv = (centre.xz - uOrigin) / uExtent;
    // Up and over the trees at the meadow's edge, and higher as the saplings come up.
    float overTrees = 1.0 - smoothstep(0.2, 0.55, texture2D(uZone, uv).r);
    centre.y = groundAtPoint(centre.xz) + 1.6 + 4.5 * (0.5 + 0.5 * sin(0.7 * th + seed * 30.0)) + 34.0 * overTrees + 5.0 * smoothstep(2.4, 3.6, uStage);
    float beating = smoothstep(-0.2, 0.3, sin(t * 0.9 + seed * 20.0));
    flap = 0.1 + 0.75 * beating * sin(t * 44.0 + seed * 70.0);
    roll = 0.5 * sin(k * th + aRnd.y * 6.283);
    shape = vec4(0.23, 0.1, 0.18, 0.03); wing = vec2(0.22, 0.45); // drawn half as big again as life, to be seen at all
    colour = vec3(0.04, 0.09, 0.16); wingColour = vec3(0.05, 0.08, 0.12);
    size = 1.0 - smoothstep(3.3, 4.3, uStage);   // gone once the meadow has closed in
  } else {
    // ---- a hawk, circling on fixed wings
    // Inside the camera's own circle and a little below it, so that from the
    // air it is seen against the meadow and from the ground against the sky.
    float th = t * 0.16 * (0.8 + 0.4 * aRnd.x) + seed * 6.283, R = 38.0 + 34.0 * aRnd.y;
    centre = vec3(uMeadow.x + 20.0 * (aRnd.z - 0.5) + R * cos(th), uMeadow.y + 44.0 + 14.0 * aRnd.x + 5.0 * sin(th * 0.31), uMeadow.z + R * sin(th));
    velocity = vec2(-sin(th), cos(th));
    flap = 0.13 + 0.03 * sin(t * 0.7 + seed * 9.0);
    roll = -0.28;
    shape = vec4(0.68, 0.34, 0.55, 0.08); wing = vec2(0.7, 0.06);
    colour = vec3(0.2, 0.13, 0.08); wingColour = vec3(0.24, 0.16, 0.1);
  }
  if (size < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  // The animal's own axes: ahead, to its right, and up, rolled into its turn.
  vec2 h = normalize(velocity + vec2(1e-5, 0.0));
  vec3 ahead = vec3(h.x, 0.0, h.y), right = vec3(-h.y, 0.0, h.x), up = vec3(0.0, 1.0, 0.0);
  vec3 r2 = right * cos(roll) + up * sin(roll), u2 = up * cos(roll) - right * sin(roll);
  vec3 local;
  float along = aPart.y, across = aPart.x, isWing = aPart.z;
  if (isWing < 0.5) {
    local = ahead * along * shape.z + r2 * across * shape.w;
  } else {
    float reach = abs(across); // 0 at the wing's root, 1 at its tip
    float chord = shape.y * mix(1.0, wing.x, reach);
    local = ahead * (along * chord - wing.y * reach * shape.x) + (r2 * sign(across) * cos(flap) + u2 * sin(flap)) * reach * shape.x;
  }
  vWorld = centre + local * size;
  // Wings a little darker at the tips; birds pale seen from underneath.
  vec3 c = isWing > 0.5 ? wingColour * mix(1.0, 0.55, smoothstep(0.6, 1.0, abs(across)) * step(aKind, 0.5)) : colour;
  vColor = c * (uSunColor * 0.5 + mix(uGroundAmbient, uSkyAmbient, 0.6) * 0.75);
  // A bird overhead is seen from its shaded side, against the bright sky: all but a silhouette.
  if (kind >= 2 && cameraPosition.y < centre.y) vColor = mix(c, vec3(0.3, 0.27, 0.22), isWing > 0.5 ? 0.3 : 0.6) * uGroundAmbient * 1.1;
  vAlpha = isWing > 0.5 ? wingAlpha : 1.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const FS = /* glsl */ `
${COMMON_GLSL}
varying vec3 vWorld;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(applyFog(vColor, vWorld), vAlpha);
}
`;

export function createWildlife({ core, shared, scene, floatLinear, meadow }) {
  // One animal: a body (a thin diamond) and two wings (a quad each), 10 vertices.
  const part = [
    0, -0.5, 0, 1, 0, 0, 0, 0.5, 0, -1, 0, 0,               // body: tail, right, head, left
    0, 0.5, 1, 0, -0.5, 1, 1, 0.5, 1, 1, -0.5, 1,            // right wing: root front, root back, tip front, tip back
    0, 0.5, 1, 0, -0.5, 1, -1, 0.5, 1, -1, -0.5, 1,          // left wing
  ];
  const index = [0, 1, 2, 0, 2, 3, 4, 5, 6, 6, 5, 7, 8, 10, 9, 10, 11, 9];
  const PATCH = 70;
  const counts = [520, 260, 22, 2]; // butterflies, dragonflies, swallows, hawks
  const total = counts.reduce((a, b) => a + b, 0);
  const off = new Float32Array(total * 2), rnd = new Float32Array(total * 4), kind = new Float32Array(total);
  let state = 4711, i = 0;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return (state >>> 8) / 16777216; };
  counts.forEach((n, k) => {
    for (let j = 0; j < n; j++, i++) {
      off[i * 2] = rand() * PATCH; off[i * 2 + 1] = rand() * PATCH;
      rnd[i * 4] = rand(); rnd[i * 4 + 1] = rand(); rnd[i * 4 + 2] = rand(); rnd[i * 4 + 3] = rand();
      kind[i] = k;
    }
  });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 3));
  geo.setIndex(index);
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
  geo.instanceCount = total;
  const defines = {};
  if (floatLinear) defines.FLOAT_LINEAR = 1;
  const material = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      ...shared,
      uHeights: { value: core.heights }, uChan: { value: core.chan }, uZone: { value: core.zone }, uStages: { value: core.stages },
      uWater: { value: core.water }, uWaterHealed: { value: core.waterHealed },
      uOrigin: { value: core.origin }, uExtent: { value: core.extent }, uRes: { value: core.res },
      uPatch: { value: PATCH }, uMeadow: { value: new THREE.Vector3(meadow.x, meadow.y, meadow.z) },
    },
    vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide, alphaToCoverage: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4; // after the plants and trees
  scene.add(mesh);
  return { mesh, count: total };
}
