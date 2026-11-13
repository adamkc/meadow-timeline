// Trees close to the camera: the scan's real trunk and branches, and a few
// thousand cards per tree that each show a scanned sprig of needles
// (tools/build_near_trees.py). They cross-fade with the distant one-card trees
// in trees.js over a few metres, per pixel.
import * as THREE from 'three';
import { COMMON_GLSL } from './shaders.js';

const CAPACITY = 256; // trees of one kind that can be near at once

const INSTANCE_GLSL = /* glsl */ `
uniform sampler2D uCBake, uFBake;
uniform sampler2DArray uCStages, uFStages;
uniform vec2 uCOrigin, uCExtent, uFOrigin, uFExtent;
uniform vec2 uLod;          // distance over which near trees hand over to cards
uniform float uInvHeight;   // 1 / height of this model in metres
attribute vec4 aTree;       // world x, y, z of the base and full height
attribute vec4 aLife;       // stage it germinates, stage it dies, seed, its pictures (see trees.js)
varying vec3 vWorld;
varying vec4 vLight;        // neighbours' shadow, sky visibility from terrain, fade, height fraction
varying vec3 vTint;

// Returns the tree-local position scaled, swayed and placed in the world.
vec3 placeTree(vec3 local) {
  float what;
  float h = treeNow(aTree.w, aLife.x, aLife.y, aLife.z, what);
  // A tree on a road's line is only there while the roads are hidden (see trees.js).
  float standing = mix(1.0, smoothstep(0.35, 0.9, uHeal), step(32768.0, aLife.w + 0.5));
  h *= standing;
  if (standing <= 0.0) what = 0.0;
  vec3 base = aTree.xyz;
  float reach = clamp(h / 16.0, 0.4, 1.0); // as in trees.js
  float fade = 1.0 - smoothstep(uLod.x * reach, uLod.y * reach, distance(cameraPosition, base + vec3(0.0, h * 0.5, 0.0)));
  float height = clamp(local.y * uInvHeight, 0.0, 1.0);

  vec2 sunward = normalize(uSunDir.xz) * 1.6;
  bool inCore = all(greaterThan(base.xz, uCOrigin + 2.0)) && all(lessThan(base.xz, uCOrigin + uCExtent - 2.0));
  vec3 bake = inCore ? texture2D(uCBake, (base.xz - uCOrigin) / uCExtent).rgb : texture2D(uFBake, (base.xz - uFOrigin) / uFExtent).rgb;
  float past = inCore ? treeShade(uCStages, (base.xz + sunward - uCOrigin) / uCExtent).x : treeShade(uFStages, (base.xz + sunward - uFOrigin) / uFExtent).x;
  float terrain = sunShadow(bake.r);
  float neighbours = terrain * past;
  vLight = vec4(mix(neighbours, terrain, smoothstep(0.05, 0.6, height)), 0.5 + 0.5 * bake.g, what > 0.5 ? fade : 0.0, height);
  float s = aLife.z;
  vTint = vec3(0.9 + 0.25 * s, 0.92 + 0.16 * fract(s * 7.3), 0.85 + 0.3 * fract(s * 3.1)) * (0.85 + 0.3 * fract(s * 13.7));

  vec3 p = base + local * (h * uInvHeight);
  vec2 wind = vec2(0.94, 0.34);
  p.xz += wind * (snoise(base.xz * 0.02 - wind * uTime * 0.25) - 0.4) * 0.006 * h * height * height;
  return p;
}
`;

const WOOD_VS = /* glsl */ `
${COMMON_GLSL}
${INSTANCE_GLSL}
attribute vec4 aBake;       // sunlight and sky reaching this point through the tree's own needles; texture number; bark blend
varying vec2 vUv;
varying vec3 vNormal;
varying vec4 vBake;
varying vec3 vLocal;
void main() {
  vWorld = placeTree(position);
  if (vLight.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vUv = uv; vNormal = normal; vBake = aBake;
  vLocal = position * (max(aTree.w, 6.0) * uInvHeight); // bark keeps its scale as the tree grows
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const WOOD_FS = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D uWood0, uWood1, uWood2, uWood3;
uniform sampler2D uBark;    // this tree's tiling bark
uniform float uSnag;        // 1 for a standing dead tree: wood bleached grey
varying vec3 vWorld;
varying vec4 vLight;
varying vec3 vTint;
varying vec2 vUv;
varying vec3 vNormal;
varying vec4 vBake;
varying vec3 vLocal;
void main() {
  vec3 N = normalize(vNormal);
  // The scans stand on a flat mat of litter; the terrain provides that here.
  if (dither(gl_FragCoord.xy) > vLight.z || (vLocal.y < 0.1 && N.y > 0.8)) discard;
  int id = int(vBake.z + 0.5);
  vec3 albedo = id == 0 ? texture2D(uWood0, vUv).rgb : id == 1 ? texture2D(uWood1, vUv).rgb
              : id == 2 ? texture2D(uWood2, vUv).rgb : texture2D(uWood3, vUv).rgb;
  if (vBake.w > 0.004) { // above the scanned base: bark projected from two sides, so there is no seam
    vec3 side = texture2D(uBark, vLocal.zy * vec2(0.9, 0.55)).rgb, front = texture2D(uBark, vLocal.xy * vec2(0.9, 0.55) + 0.37).rgb;
    float w = smoothstep(0.35, 0.65, abs(N.x) / (abs(N.x) + abs(N.z) + 1e-4));
    albedo = mix(albedo, mix(front, side, w), vBake.w);
  }
  if (uSnag > 0.5) albedo = mix(albedo, vec3(dot(albedo, vec3(0.3, 0.5, 0.2))) * vec3(2.1, 2.0, 1.82) + 0.012,
                                0.82 * smoothstep(0.02, 0.08, vLight.w)); // the skirt of litter at its foot stays as it is
  float ndl = clamp(dot(N, uSunDir) * 0.85 + 0.15, 0.0, 1.0);
  // The scan's skirt of litter at the foot of the trunk is lit like the ground around it.
  float skyLight = mix(max(vBake.y, 0.6), vBake.y, smoothstep(0.05, 0.6, vLocal.y));
  float contact = mix(0.8, 1.0, smoothstep(0.0, 0.035, vLight.w));
  vec3 light = uSunColor * ndl * vBake.x * vLight.x
             + mix(uGroundAmbient, uSkyAmbient, N.y * 0.5 + 0.5) * skyLight * vLight.y * contact;
  gl_FragColor = vec4(applyFog(albedo * light, vWorld), 1.0);
}
`;

const SPRIG_VS = /* glsl */ `
${COMMON_GLSL}
${INSTANCE_GLSL}
attribute vec3 aBake;       // sunlight, sky, and 0 at the sprig's base to 1 at its tip
varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vBake;
void main() {
  vec3 local = position;
  // The tips of sprigs stir in the wind.
  float phase = dot(position, vec3(1.7, 2.3, 1.1)) + aLife.z * 40.0;
  local += normal * (sin(uTime * 2.3 + phase) * 0.012 * aBake.z);
  vWorld = placeTree(local);
  if (vLight.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vUv = uv; vNormal = normal; vBake = aBake.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const SPRIG_FS = /* glsl */ `
${COMMON_GLSL}
uniform sampler2D uSprigs;
varying vec3 vWorld;
varying vec4 vLight;
varying vec3 vTint;
varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vBake;
void main() {
  vec4 t = texture2D(uSprigs, vUv);
  // Needles thinner than a pixel average away in the small mipmaps; give coverage back with distance.
  float lod = max(0.0, 0.5 * log2(max(dot(dFdx(vUv), dFdx(vUv)), dot(dFdy(vUv), dFdy(vUv))) * 1048576.0));
  float alpha = smoothstep(0.2, 0.6, t.a * (1.0 + 0.45 * lod));
  if (alpha < 0.06 || dither(gl_FragCoord.xy) > vLight.z) discard;
  vec3 N = normalize(vNormal);
  vec3 rd = normalize(vWorld - cameraPosition);
  float through = pow(max(dot(rd, uSunDir), 0.0), 4.0);
  float direct = vBake.x * (0.35 + 0.5 * abs(dot(N, uSunDir))) + 0.2 * through * vBake.y;
  vec3 light = uSunColor * direct * vLight.x
             + mix(uGroundAmbient, uSkyAmbient, 0.5 + 0.3 * abs(N.y)) * vBake.y * vLight.y;
  gl_FragColor = vec4(applyFog(t.rgb * vTint * light, vWorld), alpha);
}
`;

export function createNearTrees({ index, buffer, woodTextures, sprigTextures, heights, levels, shared, scene, lod, treeNow, now }) {
  const [core, far] = levels;
  const view = new DataView(buffer);
  const R = index.posRange / 32767;
  const levelUniforms = {
    uCBake: { value: core.bake }, uCStages: { value: core.stages }, uCOrigin: { value: core.origin }, uCExtent: { value: core.extent },
    uFBake: { value: far.bake }, uFStages: { value: far.stages }, uFOrigin: { value: far.origin }, uFExtent: { value: far.extent },
    uLod: { value: lod },
  };
  const wood = Object.fromEntries([0, 1, 2, 3].map((i) => [`uWood${i}`, { value: woodTextures[Math.min(i, woodTextures.length - 1)] }]));

  const kinds = index.trees.map((tree, type) => {
    // Trunk and branches.
    const [vOff, nv] = tree.vertices, [tOff, nt] = tree.triangles;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), bake = new Float32Array(nv * 4);
    for (let i = 0; i < nv; i++) {
      const o = vOff + i * 18;
      for (let k = 0; k < 3; k++) { pos[i * 3 + k] = view.getInt16(o + k * 2, true) * R; nrm[i * 3 + k] = view.getInt8(o + 6 + k) / 127; }
      uv[i * 2] = view.getInt16(o + 10, true) / index.uvScale; uv[i * 2 + 1] = view.getInt16(o + 12, true) / index.uvScale;
      bake[i * 4] = view.getUint8(o + 9) / 255; bake[i * 4 + 1] = view.getUint8(o + 14) / 255;
      bake[i * 4 + 2] = view.getUint8(o + 15); bake[i * 4 + 3] = view.getUint8(o + 16) / 255;
    }
    const woodGeo = new THREE.InstancedBufferGeometry();
    woodGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    woodGeo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    woodGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    woodGeo.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
    woodGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer.slice(tOff, tOff + nt * 6)), 1));

    // Sprig cards: four corners each, from a centre, two axes and a sprig picture.
    const [cOff, nc] = tree.cards;
    const cp = new Float32Array(nc * 12), cn = new Float32Array(nc * 12), cuv = new Float32Array(nc * 8), cb = new Float32Array(nc * 12);
    const ci = new Uint32Array(nc * 6);
    for (let i = 0; i < nc; i++) {
      const o = cOff + i * 20;
      const c = [0, 1, 2].map((k) => view.getInt16(o + k * 2, true) * R);
      const size = view.getUint16(o + 6, true) / 1000;
      const a = [0, 1, 2].map((k) => view.getInt8(o + 8 + k) / 127), b = [0, 1, 2].map((k) => view.getInt8(o + 12 + k) / 127);
      const sprig = tree.sprigs[view.getUint8(o + 11)];
      const sun = view.getUint8(o + 15) / 255, sky = view.getUint8(o + 16) / 255;
      const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const L = sprig.length * size, W = sprig.width * size;
      for (let v = 0; v < 4; v++) {
        const along = (v >> 1 ? 1 - sprig.base : -sprig.base) * L, across = (v & 1 ? 0.5 : -0.5) * W;
        for (let k = 0; k < 3; k++) { cp[(i * 4 + v) * 3 + k] = c[k] + a[k] * along + b[k] * across; cn[(i * 4 + v) * 3 + k] = n[k]; }
        cuv[(i * 4 + v) * 2] = sprig.uv[v][0]; cuv[(i * 4 + v) * 2 + 1] = sprig.uv[v][1];
        cb[(i * 4 + v) * 3] = sun; cb[(i * 4 + v) * 3 + 1] = sky; cb[(i * 4 + v) * 3 + 2] = v >> 1;
      }
      ci.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    const sprigGeo = new THREE.InstancedBufferGeometry();
    sprigGeo.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    sprigGeo.setAttribute('normal', new THREE.BufferAttribute(cn, 3));
    sprigGeo.setAttribute('uv', new THREE.BufferAttribute(cuv, 2));
    sprigGeo.setAttribute('aBake', new THREE.BufferAttribute(cb, 3));
    sprigGeo.setIndex(new THREE.BufferAttribute(ci, 1));

    const aTree = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    const aLife = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    aTree.setUsage(THREE.DynamicDrawUsage); aLife.setUsage(THREE.DynamicDrawUsage);
    const uniforms = { ...shared, ...levelUniforms, uInvHeight: { value: 1 / heights[type] } };
    const meshes = [
      [woodGeo, new THREE.ShaderMaterial({ uniforms: { ...uniforms, ...wood, uBark: { value: woodTextures[tree.bark] }, uSnag: { value: tree.snag ? 1 : 0 } },
        vertexShader: WOOD_VS, fragmentShader: WOOD_FS, side: THREE.DoubleSide })],
      [sprigGeo, new THREE.ShaderMaterial({ uniforms: { ...uniforms, uSprigs: { value: sprigTextures[tree.atlas] } },
        vertexShader: SPRIG_VS, fragmentShader: SPRIG_FS, side: THREE.DoubleSide, alphaToCoverage: true })],
    ].filter(([geo]) => geo.index.count > 0).map(([geo, material]) => {
      geo.setAttribute('aTree', aTree);
      geo.setAttribute('aLife', aLife);
      geo.instanceCount = 0;
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1; // nearest things first
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    });
    return { aTree, aLife, meshes, count: 0 };
  });

  return {
    // Fill each kind's instance list with the standing trees within reach of the camera.
    update(camera, tiles) {
      const reach = lod.y + 1, stage = shared.uStage.value;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (const k of kinds) k.count = 0;
      if (reach > 2) {
        for (const t of tiles) {
          if (t.count === 0 || t.box.distanceToPoint(camera.position) > reach) continue;
          for (let i = 0; i < t.count; i++) {
            const x = t.tree[i * 4], z = t.tree[i * 4 + 2];
            const dx = x - cx, dz = z - cz;
            if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
            const h = treeNow(t, i, stage);
            if (now.what === 0) continue;
            const dy = t.tree[i * 4 + 1] + h * 0.5 - cy;
            const r = lod.y * Math.min(1, Math.max(0.4, h / 16)) + 1; // small trees are geometry only close in
            if (dx * dx + dy * dy + dz * dz > r * r) continue;
            const k = kinds[now.type];
            if (!k || k.count >= CAPACITY) continue;
            k.aTree.array.set(t.tree.subarray(i * 4, i * 4 + 4), k.count * 4);
            k.aLife.array.set(t.life.subarray(i * 4, i * 4 + 4), k.count * 4);
            k.count++;
          }
        }
      }
      let total = 0;
      for (const k of kinds) {
        for (const m of k.meshes) { m.geometry.instanceCount = k.count; m.visible = k.count > 0; }
        if (k.count) {
          k.aTree.clearUpdateRanges(); k.aTree.addUpdateRange(0, k.count * 4); k.aTree.needsUpdate = true;
          k.aLife.clearUpdateRanges(); k.aLife.addUpdateRange(0, k.count * 4); k.aLife.needsUpdate = true;
        }
        total += k.count;
      }
      return total;
    },
  };
}
