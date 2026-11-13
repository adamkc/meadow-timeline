// The scene is drawn into a multisampled HDR buffer, then finished here:
// each frame is blended with the ones before it (below), then a soft bloom
// from a chain of half-size blurs, a filmic tone curve, a vignette and a
// little grain.
//
// Blending over time is what keeps fine foliage from shimmering as the camera
// moves. Every frame the picture is drawn shifted by a different fraction of a
// pixel; each pixel then looks up where its surface was in the last result
// (from its depth and the two camera positions) and keeps most of that, as
// long as it is a colour found around the pixel now. A dozen frames' worth of
// samples end up in every pixel, and a blade thinner than a pixel becomes a
// steady faint line instead of one that blinks.
import * as THREE from 'three';

const VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const DOWN_FS = /* glsl */ `
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uFirst;
varying vec2 vUv;
void main() {
  vec3 a = texture2D(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb, b = texture2D(uTex, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture2D(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb, d = texture2D(uTex, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  if (uFirst > 0.5) { // weight down very bright samples so the sun doesn't flicker
    float wa = 1.0 / (1.0 + dot(a, vec3(0.33))), wb = 1.0 / (1.0 + dot(b, vec3(0.33)));
    float wc = 1.0 / (1.0 + dot(c, vec3(0.33))), wd = 1.0 / (1.0 + dot(d, vec3(0.33)));
    gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
  } else {
    gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
  }
}
`;
const UP_FS = /* glsl */ `
uniform sampler2D uTex; uniform sampler2D uAdd; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(uTex, vUv).rgb * 4.0;
  s += (texture2D(uTex, vUv + uTexel * vec2(1.0, 0.0)).rgb + texture2D(uTex, vUv - uTexel * vec2(1.0, 0.0)).rgb
      + texture2D(uTex, vUv + uTexel * vec2(0.0, 1.0)).rgb + texture2D(uTex, vUv - uTexel * vec2(0.0, 1.0)).rgb) * 2.0;
  s += texture2D(uTex, vUv + uTexel).rgb + texture2D(uTex, vUv - uTexel).rgb
     + texture2D(uTex, vUv + uTexel * vec2(1.0, -1.0)).rgb + texture2D(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  gl_FragColor = vec4(s / 16.0 + texture2D(uAdd, vUv).rgb, 1.0);
}
`;
const BLEND_FS = /* glsl */ `
uniform sampler2D uCurrent; uniform sampler2D uHistory; uniform sampler2D uDepth;
uniform mat4 uReproject;   // from this frame's screen to the last frame's
uniform vec2 uTexel;
uniform float uKeep;       // how much of the earlier frames to keep; 0 when there are none
varying vec2 vUv;
// Work on colours with the brightest squeezed in, so one glint cannot outweigh everything around it.
vec3 squash(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 unsquash(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
// The earlier result, read with a sharper filter than plain interpolation
// (Catmull-Rom in nine lookups), which would soften the picture a little more every frame.
vec3 historyAt(vec2 uv) {
  vec2 pos = uv / uTexel, tc = floor(pos - 0.5) + 0.5, f = pos - tc;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (tc - 1.0) * uTexel, t3 = (tc + 2.0) * uTexel, t12 = (tc + w2 / w12) * uTexel;
  vec3 r = (texture2D(uHistory, vec2(t0.x, t0.y)).rgb * w0.x + texture2D(uHistory, vec2(t12.x, t0.y)).rgb * w12.x + texture2D(uHistory, vec2(t3.x, t0.y)).rgb * w3.x) * w0.y
         + (texture2D(uHistory, vec2(t0.x, t12.y)).rgb * w0.x + texture2D(uHistory, vec2(t12.x, t12.y)).rgb * w12.x + texture2D(uHistory, vec2(t3.x, t12.y)).rgb * w3.x) * w12.y
         + (texture2D(uHistory, vec2(t0.x, t3.y)).rgb * w0.x + texture2D(uHistory, vec2(t12.x, t3.y)).rgb * w12.x + texture2D(uHistory, vec2(t3.x, t3.y)).rgb * w3.x) * w3.y;
  return max(r, 0.0);
}
void main() {
  vec3 c = squash(texture2D(uCurrent, vUv).rgb), lo = c, hi = c;
  float z = texture2D(uDepth, vUv).r;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec2 at = vUv + vec2(float(i), float(j)) * uTexel;
    vec3 s = squash(texture2D(uCurrent, at).rgb);
    lo = min(lo, s); hi = max(hi, s);
    // The nearest surface around the pixel decides where it came from, so the
    // edge of a tree moves with the tree and not with the ground behind it.
    if (i == 0 || j == 0) z = min(z, texture2D(uDepth, at).r);
  }
  vec4 p = uReproject * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  vec2 was = p.xy / p.w * 0.5 + 0.5;
  float keep = uKeep * step(0.0, p.w) * step(0.0, was.x) * step(was.x, 1.0) * step(0.0, was.y) * step(was.y, 1.0);
  vec3 h = keep > 0.0 ? clamp(squash(historyAt(was)), lo, hi) : c;
  gl_FragColor = vec4(unsquash(mix(c, h, keep)), 1.0);
}
`;
const FINAL_FS = /* glsl */ `
uniform sampler2D uScene; uniform sampler2D uBloom; uniform sampler2D uCoarse;
uniform float uBloomAmount; uniform float uLevels; uniform float uSeed; uniform float uAdapt; uniform float uGrain;
uniform vec2 uSpread; // supersampling: how far apart to take four samples of the scene, 0 when it is the canvas's own size
uniform vec3 uSharpen; // one texel of the scene, and how much to sharpen it (0 for none)
varying vec2 vUv;
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// The scene at this pixel. When it was drawn larger than the canvas, four
// samples are averaged, the very bright ones counting for less so a glint
// does not flash as it crosses a pixel.
vec3 scenePixel() {
  if (uSpread.x <= 0.0) {
    vec3 c = texture2D(uScene, vUv).rgb;
    if (uSharpen.z <= 0.0) return c;
    // Blending frames over time softens the picture slightly; put the edge
    // back, without overshooting what is around the pixel.
    vec3 l = texture2D(uScene, vUv - vec2(uSharpen.x, 0.0)).rgb, r = texture2D(uScene, vUv + vec2(uSharpen.x, 0.0)).rgb;
    vec3 d = texture2D(uScene, vUv - vec2(0.0, uSharpen.y)).rgb, u = texture2D(uScene, vUv + vec2(0.0, uSharpen.y)).rgb;
    return clamp(c + uSharpen.z * (c - 0.25 * (l + r + d + u)), min(c, min(min(l, r), min(d, u))), max(c, max(max(l, r), max(d, u))));
  }
  vec3 a = texture2D(uScene, vUv + uSpread * vec2(-1.0, -1.0)).rgb, b = texture2D(uScene, vUv + uSpread * vec2(1.0, -1.0)).rgb;
  vec3 c = texture2D(uScene, vUv + uSpread * vec2(-1.0, 1.0)).rgb, d = texture2D(uScene, vUv + uSpread).rgb;
  float wa = 1.0 / (1.0 + dot(a, vec3(0.33))), wb = 1.0 / (1.0 + dot(b, vec3(0.33)));
  float wc = 1.0 / (1.0 + dot(c, vec3(0.33))), wd = 1.0 / (1.0 + dot(d, vec3(0.33)));
  return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
}
void main() {
  vec3 c = mix(scenePixel(), texture2D(uBloom, vUv).rgb / uLevels, uBloomAmount);
  // Exposure follows the scene the way an eye or a camera does: brighter in
  // forest shade, darker facing the sun. The coarsest blur level stands in for
  // the average brightness, so it changes smoothly as the view moves.
  vec3 avg = texture2D(uCoarse, vec2(0.5, 0.45)).rgb * 0.4 + 0.15 * (texture2D(uCoarse, vec2(0.25, 0.4)).rgb
           + texture2D(uCoarse, vec2(0.75, 0.4)).rgb + texture2D(uCoarse, vec2(0.4, 0.7)).rgb + texture2D(uCoarse, vec2(0.6, 0.2)).rgb);
  float lum = dot(avg, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(1.0, clamp(pow(0.27 / max(lum, 0.02), 0.45), 0.75, 1.8), uAdapt);
  vec2 q = vUv - 0.5;
  c *= mix(1.0, 0.7, smoothstep(0.3, 0.95, length(q) * 1.25));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float grain = hash12(gl_FragCoord.xy + uSeed * 91.7) + hash12(gl_FragCoord.yx + uSeed * 37.3) - 1.0;
  gl_FragColor.rgb += grain * 0.022 * uGrain;
}
`;

// Sub-pixel shifts for successive frames (the Halton sequence, bases 2 and 3), in pixels.
const SHIFTS = Array.from({ length: 16 }, (_, i) => {
  const halton = (n, base) => { let f = 1, r = 0; for (let k = n; k > 0; k = Math.floor(k / base)) { f /= base; r += f * (k % base); } return r; };
  return [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5];
});

export function createPost(renderer, { bloom = 0.07, adapt = 1, grain = 1, blend = 0.9, sharpen = 0.5, ditherShift = null } = {}) {
  const LEVELS = 5;
  const hdr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true,
    ...(blend > 0 ? { depthTexture: new THREE.DepthTexture(1, 1) } : {}) });
  const half = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const history = blend > 0 ? [half(), half()] : null;
  const viewProj = new THREE.Matrix4(), lastViewProj = new THREE.Matrix4(), inverse = new THREE.Matrix4();
  let fresh = true; // nothing earlier to blend with: the first frame, after a resize, after the camera jumps
  const down = Array.from({ length: LEVELS }, half), up = Array.from({ length: LEVELS - 1 }, half);
  const pass = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  const downMat = pass(DOWN_FS, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } });
  const upMat = pass(UP_FS, { uTex: { value: null }, uAdd: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const blendMat = pass(BLEND_FS, {
    uCurrent: { value: hdr.texture }, uHistory: { value: null }, uDepth: { value: hdr.depthTexture ?? null },
    uReproject: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uKeep: { value: 0 },
  });
  const finalMat = pass(FINAL_FS, {
    uScene: { value: hdr.texture }, uBloom: { value: null }, uBloomAmount: { value: bloom },
    uLevels: { value: LEVELS }, uSeed: { value: 0 }, uCoarse: { value: down[LEVELS - 1].texture }, uAdapt: { value: adapt }, uGrain: { value: grain }, uSpread: { value: new THREE.Vector2() }, uSharpen: { value: new THREE.Vector3() },
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), downMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const draw = (material, target) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  };

  let frame = 0;
  return {
    // The scene is w x h; the canvas outW x outH, the same or smaller. The
    // bloom is built at the canvas's size so it looks the same either way.
    setSize(w, h, outW = w, outH = h) {
      hdr.setSize(w, h);
      if (history) for (const t of history) t.setSize(w, h);
      finalMat.uniforms.uSharpen.value.set(1 / w, 1 / h, history ? sharpen : 0);
      fresh = true;
      finalMat.uniforms.uSpread.value.set(w > outW ? (w / outW - 1) * 0.5 / w : 0, h > outH ? (h / outH - 1) * 0.5 / h : 0);
      for (let i = 0; i < LEVELS; i++) {
        const dw = Math.max(1, outW >> (i + 1)), dh = Math.max(1, outH >> (i + 1));
        down[i].setSize(dw, dh);
        if (i < LEVELS - 1) up[i].setSize(dw, dh);
      }
    },
    // Forget the earlier frames: call when the camera jumps.
    cut() { fresh = true; },
    render(scene, camera) {
      let result = hdr;
      if (history) {
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        blendMat.uniforms.uReproject.value.multiplyMatrices(lastViewProj, inverse.copy(viewProj).invert());
        lastViewProj.copy(viewProj);
        const [sx, sy] = SHIFTS[frame % SHIFTS.length];
        camera.projectionMatrix.elements[8] += 2 * sx / hdr.width;
        camera.projectionMatrix.elements[9] += 2 * sy / hdr.height;
        if (ditherShift) ditherShift.value = 5.588238 * (frame % 64);
      }
      renderer.setRenderTarget(hdr);
      renderer.render(scene, camera);
      if (history) {
        camera.updateProjectionMatrix(); // take the shift back out
        const [to, from] = frame % 2 ? history : [history[1], history[0]];
        blendMat.uniforms.uHistory.value = from.texture;
        blendMat.uniforms.uTexel.value.set(1 / hdr.width, 1 / hdr.height);
        blendMat.uniforms.uKeep.value = fresh ? 0 : blend;
        draw(blendMat, to);
        fresh = false;
        result = to;
      }
      finalMat.uniforms.uScene.value = result.texture;
      let src = result;
      for (let i = 0; i < LEVELS; i++) {
        downMat.uniforms.uTex.value = src.texture;
        downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
        draw(downMat, down[i]);
        src = down[i];
      }
      for (let i = LEVELS - 2; i >= 0; i--) { // widen back up, adding each finer level
        upMat.uniforms.uTex.value = src.texture;
        upMat.uniforms.uAdd.value = down[i].texture;
        upMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        draw(upMat, up[i]);
        src = up[i];
      }
      finalMat.uniforms.uBloom.value = src.texture;
      finalMat.uniforms.uSeed.value = (frame++ % 61) / 61;
      draw(finalMat, null);
    },
  };
}
