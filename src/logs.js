// Downed wood: two scanned logs (Poly Haven, CC0; tools/build_logs.py) strewn
// through the forest and the thickets by tools/prep_terrain.py, each scaled,
// stretched and turned. Only those near the camera are drawn.
import * as THREE from 'three';
import { COMMON_GLSL } from './shaders.js';

const CAPACITY = 400;       // logs of one model drawn at once
const REACH = [75, 95];     // metres over which logs fade out

const LOG_VS = /* glsl */ `
${COMMON_GLSL}
uniform vec2 uReach;
attribute vec4 aPlace;      // world x, y, z of the middle and heading
attribute vec4 aShape;      // size, stretch along the length, pitch, stage at which it comes to lie here
attribute float aSeed;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vInfo;         // height above the log's underside (in radii), fade, seed
void main() {
  float fade = (1.0 - smoothstep(uReach.x, uReach.y, distance(cameraPosition, aPlace.xyz)))
             * smoothstep(aShape.w - 0.3, aShape.w, uStage);
  if (fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = position * aShape.x;
  p.x *= aShape.y;
  float cp = cos(aShape.z), sp = sin(aShape.z), cy = cos(aPlace.w), sy = sin(aPlace.w);
  // Pitch about the log's own sideways axis, then turn to its heading.
  vec3 q = vec3(p.x * cp - p.y * sp, p.x * sp + p.y * cp, p.z);
  vec3 n = vec3(normal.x * cp - normal.y * sp, normal.x * sp + normal.y * cp, normal.z);
  vWorld = aPlace.xyz + vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
  vNormal = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);
  vUv = uv;
  vInfo = vec3(position.y, fade, aSeed);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const LOG_FS = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D uLog, uBake;
uniform sampler2DArray uStages;
uniform vec2 uOrigin, uExtent;
uniform float uRadius;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vInfo;
void main() {
  if (hash12(gl_FragCoord.xy) > vInfo.y) discard;
  vec3 albedo = texture2D(uLog, vUv).rgb * 1.35;
  // Many logs are old: bleached and grey.
  float old = smoothstep(0.2, 0.7, vInfo.z);
  albedo = mix(albedo, vec3(dot(albedo, vec3(0.3, 0.5, 0.2))) * vec3(1.9, 1.8, 1.65) + 0.012, 0.75 * old);
  // Lit like the ground it lies on: the same baked shadows, a pixel at a time.
  vec2 uv = (vWorld.xz - uOrigin) / uExtent;
  vec3 bake = texture2D(uBake, uv).rgb;
  vec2 shade = treeShade(uStages, uv);
  float cover = shade.y;
  float shadow = sunShadow(bake.r) * shade.x;
  float vis = 0.5 + 0.5 * bake.g;
  vec3 N = normalize(vNormal);
  float under = smoothstep(-0.2, 0.9, vInfo.x / uRadius);   // dark where it meets the ground
  float ndl = clamp(dot(N, uSunDir) * 0.85 + 0.15, 0.0, 1.0);
  vec3 light = uSunColor * ndl * shadow * under
             + mix(uGroundAmbient, uSkyAmbient, N.y * 0.5 + 0.5) * vis * vis * (1.0 - 0.5 * cover) * mix(0.35, 1.0, under);
  gl_FragColor = vec4(applyFog(albedo * light, vWorld), 1.0);
}
`;

export function createLogs({ index, buffer, textures, places, core, coreCorner, shared, groundAt, scene }) {
  const view = new DataView(buffer);
  const R = index.posRange / 32767;
  const reach = new THREE.Vector2(...REACH);

  const models = index.models.map((m, k) => {
    const [vAt, nv] = m.vertices, [tAt, nt] = m.triangles;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    for (let i = 0; i < nv; i++) {
      const o = vAt + i * index.vertexBytes;
      for (let c = 0; c < 3; c++) { pos[i * 3 + c] = view.getInt16(o + c * 2, true) * R; nrm[i * 3 + c] = view.getInt8(o + 6 + c) / 127; }
      uv[i * 2] = view.getUint16(o + 10, true) / 65535; uv[i * 2 + 1] = view.getUint16(o + 12, true) / 65535;
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer.slice(tAt, tAt + nt * 6)), 1));
    const attrs = { aPlace: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4),
      aShape: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4),
      aSeed: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1) };
    for (const [name, a] of Object.entries(attrs)) { a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); }
    geo.instanceCount = 0;
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { ...shared, uLog: { value: textures[k] }, uBake: { value: core.bake }, uStages: { value: core.stages },
        uOrigin: { value: core.origin }, uExtent: { value: core.extent }, uReach: { value: reach }, uRadius: { value: m.radius } },
      vertexShader: LOG_VS, fragmentShader: LOG_FS,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.visible = false;
    scene.add(mesh);
    return { ...attrs, mesh, half: m.halfLength, radius: m.radius };
  });

  // Each log: where it lies, already settled on the ground between its two ends.
  const data = new DataView(places);
  const count = places.byteLength / 10;
  const logs = new Float32Array(count * 10); // x, y, z, heading, size, stretch, pitch, stage it appears, seed, model
  for (let i = 0; i < count; i++) {
    const o = i * 10;
    const x = data.getUint16(o, true) / 10 + coreCorner.x, z = data.getUint16(o + 2, true) / 10 + coreCorner.y;
    const heading = data.getUint8(o + 4) / 256 * Math.PI * 2, size = data.getUint8(o + 5) / 50, stretch = data.getUint8(o + 6) / 100;
    const model = Math.min(models.length - 1, data.getUint8(o + 9));
    const half = models[model].half * size * stretch, dx = Math.cos(heading) * half, dz = -Math.sin(heading) * half;
    const y0 = groundAt(x - dx, z - dz), y1 = groundAt(x + dx, z + dz);
    // Sunk a little into the duff.
    logs.set([x, (y0 + y1) / 2 - 0.25 * models[model].radius * size, z, heading, size, stretch, Math.atan2(y1 - y0, 2 * half),
      data.getUint8(o + 7) === 0 ? -10 : data.getUint8(o + 7) / 255 * 8 - 1, data.getUint8(o + 8) / 255, model], i * 10);
  }

  return {
    count,
    update(camera) {
      const stage = shared.uStage.value, far2 = REACH[1] * REACH[1];
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (const m of models) m.n = 0;
      for (let i = 0; i < count; i++) {
        const o = i * 10;
        if (logs[o + 7] - 0.3 > stage) continue;
        const dx = logs[o] - cx, dy = logs[o + 1] - cy, dz = logs[o + 2] - cz;
        if (dx * dx + dy * dy + dz * dz > far2) continue;
        const m = models[logs[o + 9]];
        if (m.n >= CAPACITY) continue;
        m.aPlace.array.set(logs.subarray(o, o + 4), m.n * 4);
        m.aShape.array.set(logs.subarray(o + 4, o + 8), m.n * 4);
        m.aSeed.array[m.n] = logs[o + 8];
        m.n++;
      }
      let total = 0;
      for (const m of models) {
        m.mesh.geometry.instanceCount = m.n;
        m.mesh.visible = m.n > 0;
        for (const a of [m.aPlace, m.aShape, m.aSeed]) { a.clearUpdateRanges(); a.addUpdateRange(0, m.n * a.itemSize); a.needsUpdate = true; }
        total += m.n;
      }
      return total;
    },
  };
}
